/**
 * send-message must never relay without an admin session (item 5), and
 * admin-api must actually reach auto-notify (item 13).
 */
import {
  loadFunction, fromGitHead, installDenoEnv, makeSupabaseStub, installFetchStub, sha256Hex, post,
} from '../helpers/edge.mjs';

const expect = globalThis.__EXPECT__;
const section = globalThis.__SECTION__;

const TOKEN = 'session-token';
const TOKEN_HASH = sha256Hex(TOKEN);
const SERVICE_KEY = 'service-role-key';
const ANON_KEY = 'anon-key';
const VALID_SESSION = { admin_id: 'id-super', token: TOKEN };

installDenoEnv({
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  // Present on every Supabase project — this is what used to hijack the
  // Authorization header on internal calls to auto-notify.
  SUPABASE_ANON_KEY: ANON_KEY,
  TELEGRAM_BOT_TOKEN: 'bot-token',
  ADMIN_TELEGRAM_ID: '5720497431',
});

makeSupabaseStub({
  tables: {
    admin_accounts: [{
      id: 'id-super', role: 'super_admin', is_active: true, session_expires_at: null,
      session_token: TOKEN_HASH, email: 'a@x.uz', first_name: 'A', password_hash: '$2a$10$x',
    }],
    products: [{ id: 'p1', name: { ru: 'Куртка' }, price: 400000, stock: 5, slug: 'kurtka', is_active: true }],
    favorites: [{ id: 'f1', product_id: 'p1', telegram_user_id: 111, notify_price: true, notify_stock: true }],
    orders: [{ id: 'o1', telegram_user_id: 42, status: 'new' }],
  },
  rpc: { insert_notification: { data: null, error: null } },
});

// ── item 5: send-message ────────────────────────────────────────────────────
let captured = installFetchStub();
const sendMessage = await loadFunction('send-message');
const oldSendMessage = await loadFunction(fromGitHead('supabase/functions/send-message/index.ts'));

async function relay(label, body, expectedStatus) {
  captured.telegram.length = 0;
  const res = await post(sendMessage, body);
  const sentNow = captured.telegram.length;
  captured.telegram.length = 0;
  const oldRes = await post(oldSendMessage, body);
  const sentBefore = captured.telegram.length;
  expect(`${label} → ${expectedStatus}, отправлено 0 (старый код: ${oldRes.status}, отправлено ${sentBefore})`,
    res.status === expectedStatus && sentNow === 0,
    `новый ${res.status}, отправлено ${sentNow}`);
}

section('send-message: без админской сессии (пункт 5)');
await relay('прямое сообщение без сессии', { telegram_user_id: 999, message: 'phishing' }, 401);
await relay('то же с sender_type: customer', { telegram_user_id: 999, message: 'phishing', sender_type: 'customer' }, 401);
await relay('рассылка по товару без сессии', { product_id: 'p1', type: 'price_drop' }, 401);
await relay('подделанный токен', { telegram_user_id: 999, message: 'x', admin_session: { admin_id: 'id-super', token: 'wrong' } }, 401);

section('send-message: легитимное использование');
captured.telegram.length = 0;
let res = await post(sendMessage, { telegram_user_id: 42, message: 'Здравствуйте!', admin_session: VALID_SESSION });
expect('админ пишет клиенту → 200, одно сообщение',
  res.status === 200 && captured.telegram.length === 1, `${res.status}, ${captured.telegram.length}`);

for (const [label, body] of [
  ['отрицательный telegram_user_id', { telegram_user_id: -5, message: 'x', admin_session: VALID_SESSION }],
  ['пустое сообщение', { telegram_user_id: 42, message: '   ', admin_session: VALID_SESSION }],
  ['сообщение длиннее 4096', { telegram_user_id: 42, message: 'a'.repeat(5000), admin_session: VALID_SESSION }],
]) {
  captured.telegram.length = 0;
  const r = await post(sendMessage, body);
  expect(`${label} → 400, ничего не отправлено`, r.status === 400 && captured.telegram.length === 0,
    `${r.status}, отправлено ${captured.telegram.length}`);
}

// ── item 13: admin-api → auto-notify ────────────────────────────────────────
section('admin-api → auto-notify (пункт 13)');

const autoNotify = await loadFunction('auto-notify');
let seen = { status: null, auth: null };

captured = installFetchStub([{
  match: '/functions/v1/auto-notify',
  handle: async (_url, opts) => {
    seen.auth = opts.headers?.Authorization ?? null;
    const r = await autoNotify(new Request('https://stub/auto-notify', {
      method: 'POST', headers: opts.headers, body: opts.body,
    }));
    seen.status = r.status;
    const text = await r.clone().text();
    return { ok: r.ok, status: r.status, json: async () => JSON.parse(text || '{}'), text: async () => text };
  },
}]);

const priceDrop = { action: 'update', table: 'products', id: 'p1', data: { price: 300000 }, admin_session: VALID_SESSION };

const oldAdminApi = await loadFunction(fromGitHead('supabase/functions/admin-api/index.ts'));
seen = { status: null, auth: null }; captured.telegram.length = 0;
await post(oldAdminApi, priceDrop);
await new Promise((r) => setTimeout(r, 300));
const oldSeen = { ...seen, sent: captured.telegram.length };

const adminApi = await loadFunction('admin-api');
seen = { status: null, auth: null }; captured.telegram.length = 0;
await post(adminApi, priceDrop);
await new Promise((r) => setTimeout(r, 500));

expect(`старый код слал anon-ключ и получал ${oldSeen.status}, отправлено ${oldSeen.sent}`,
  oldSeen.auth === `Bearer ${ANON_KEY}` && oldSeen.status === 401 && oldSeen.sent === 0,
  JSON.stringify(oldSeen));
expect('новый код авторизуется service-ключом', seen.auth === `Bearer ${SERVICE_KEY}`, `= ${seen.auth}`);
expect('auto-notify отвечает 200', seen.status === 200, `= ${seen.status}`);
expect('уведомление о снижении цены реально отправлено',
  captured.telegram.length === 1 && /дешевле/.test(captured.telegram[0]?.body?.text ?? ''),
  JSON.stringify(captured.telegram).slice(0, 100));

section('auto-notify: посторонние вызовы');
for (const [label, auth] of [['без заголовка', null], ['anon-ключ', `Bearer ${ANON_KEY}`], ['мусор', 'Bearer nope']]) {
  const r = await autoNotify(new Request('https://stub/auto-notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify({ product_id: 'p1', type: 'price_drop' }),
  }));
  expect(`${label} → 401`, r.status === 401, `получили ${r.status}`);
}
