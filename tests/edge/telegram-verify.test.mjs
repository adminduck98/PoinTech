/**
 * Telegram initData verification (item 1).
 *
 * The expected hashes are produced here with node:crypto straight from the
 * Telegram specification, so this does not share an implementation with the
 * code under test.
 */
import crypto from 'node:crypto';
import { installDenoEnv, PROJECT_ROOT, runEsbuild } from '../helpers/edge.mjs';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const expect = globalThis.__EXPECT__;
const section = globalThis.__SECTION__;

installDenoEnv({});

// Transpile the shared module (it is plain TypeScript, no Deno APIs at import time).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-'));
const out = path.join(tmp, 'telegram-verify.mjs');
runEsbuild(path.join(PROJECT_ROOT, 'supabase/functions/_shared/telegram-verify.ts'), out);
const { verifyTelegramInitData } = await import(`file://${out}`);

const BOT_TOKEN = '8983741088:AAFAKEtokenFORtestsONLY000000000000';
const USER = { id: 5720497431, first_name: 'Aziz', username: 'aziz', language_code: 'ru' };
const now = () => Math.floor(Date.now() / 1000);

/** Sign exactly the way Telegram documents it. */
function sign(fields, token = BOT_TOKEN) {
  const p = new URLSearchParams(fields);
  const dcs = [...p.entries()].filter(([k]) => k !== 'hash' && k !== 'signature')
    .map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
}

/** The old, broken scheme: HMAC keyed directly with the bot token. */
function signLegacy(fields, token = BOT_TOKEN) {
  const p = new URLSearchParams(fields);
  const dcs = [...p.entries()].filter(([k]) => k !== 'hash')
    .map(([k, v]) => `${k}=${v}`).sort().join('\n');
  p.set('hash', crypto.createHmac('sha256', token).update(dcs).digest('hex'));
  return p.toString();
}

const base = { user: JSON.stringify(USER), auth_date: String(now()), query_id: 'AAHdF6IQ' };

section('принимает подлинные данные');
let r = await verifyTelegramInitData(sign(base), BOT_TOKEN);
expect('валидные initData приняты, user извлечён', r.valid === true && r.user.id === USER.id, JSON.stringify(r).slice(0, 80));

r = await verifyTelegramInitData(sign({ ...base, signature: 'Zm9vYmFy' }), BOT_TOKEN);
expect('работает при наличии поля signature', r.valid === true);

section('отвергает подделки');
r = await verifyTelegramInitData(signLegacy(base), BOT_TOKEN);
expect('данные, подписанные СТАРОЙ схемой, отвергнуты', r.valid === false && r.error === 'Invalid hash', JSON.stringify(r));

const tampered = new URLSearchParams(sign(base));
tampered.set('user', JSON.stringify({ ...USER, id: 111222333 }));
r = await verifyTelegramInitData(tampered.toString(), BOT_TOKEN);
expect('подмена user.id отвергнута', r.valid === false && r.error === 'Invalid hash');

r = await verifyTelegramInitData(sign(base, '999:OTHER-token'), BOT_TOKEN);
expect('подпись чужим токеном отвергнута', r.valid === false && r.error === 'Invalid hash');

const forged = new URLSearchParams(base);
forged.set('hash', 'a'.repeat(64));
r = await verifyTelegramInitData(forged.toString(), BOT_TOKEN);
expect('произвольный hash отвергнут', r.valid === false);

section('срок действия и валидация полей');
r = await verifyTelegramInitData(sign({ ...base, auth_date: String(now() - 25 * 3600) }), BOT_TOKEN);
expect('старше 24 часов — отклонено', r.valid === false && r.error === 'initData expired');

r = await verifyTelegramInitData(sign({ ...base, auth_date: String(now() + 3600) }), BOT_TOKEN);
expect('auth_date в будущем — отклонено', r.valid === false && r.error === 'auth_date is in the future');

r = await verifyTelegramInitData('', BOT_TOKEN);
expect('пустые initData — отклонено', r.valid === false && r.error === 'Missing initData');

r = await verifyTelegramInitData(sign(base), '');
expect('токен бота не задан — отклонено (fail closed)', r.valid === false && r.error === 'Bot token is not configured');

r = await verifyTelegramInitData(sign({ auth_date: String(now()) }), BOT_TOKEN);
expect('подписано, но без user — отклонено', r.valid === false && r.error === 'initData contains no user');

r = await verifyTelegramInitData(sign({ ...base, user: JSON.stringify({ id: 0, first_name: 'X' }) }), BOT_TOKEN);
expect('нулевой user.id — отклонено', r.valid === false && r.error === 'Invalid user id in initData');
