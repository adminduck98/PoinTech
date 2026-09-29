/**
 * admin-api: role separation, credential protection, password handling.
 * Each case is also run against the pre-fix version from git HEAD, so the
 * suite proves it detects the original defects rather than just passing.
 */
import {
  loadFunction, fromGitHead, installDenoEnv, makeSupabaseStub, installFetchStub, sha256Hex, post,
} from '../helpers/edge.mjs';

const expect = globalThis.__EXPECT__;
const section = globalThis.__SECTION__;

const TOKEN = 'session-token';
const TOKEN_HASH = sha256Hex(TOKEN);

const ACCOUNTS = {
  'id-super': { id: 'id-super', role: 'super_admin' },
  'id-admin': { id: 'id-admin', role: 'admin' },
  'id-manager': { id: 'id-manager', role: 'manager' },
  'id-seller': { id: 'id-seller', role: 'seller' },
  'id-support': { id: 'id-support', role: 'support' },
  'id-content': { id: 'id-content', role: 'content' },
};
const SECRET_HASH = '$2a$10$THIS-IS-A-PASSWORD-HASH';
const adminRows = () => Object.values(ACCOUNTS).map((a) => ({
  ...a, is_active: true, session_expires_at: null, session_token: TOKEN_HASH,
  email: `${a.id}@shop.uz`, first_name: 'Имя', username: null,
  password_hash: SECRET_HASH, created_at: 't', updated_at: 't', last_login_at: 't',
}));

installDenoEnv({
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  TELEGRAM_BOT_TOKEN: 'bot-token',
});

const calls = makeSupabaseStub({
  tables: {
    admin_accounts: adminRows,
    products: [{ id: 'p1', price: 100, stock: 5, name: { ru: 'Товар' } }],
    orders: [{ id: 'o1', telegram_user_id: 42, status: 'new' }],
    audit_log: [{ id: 'a1' }],
    favorites: [{ id: 'f1' }],
    coupons: [{ id: 'c1' }],
    banners: [{ id: 'b1' }],
    returns: [{ id: 'r1' }],
  },
  rpc: {
    hash_admin_password: (args) => ({ data: `$2a$10$${sha256Hex(args.p_password).slice(0, 22)}`, error: null }),
    append_order_status: { data: { id: 'o1', status: 'shipping' }, error: null },
  },
});
installFetchStub();

const api = await loadFunction('admin-api');
const old = await loadFunction(fromGitHead('supabase/functions/admin-api/index.ts'));

const as = (who, body) => post(api, { ...body, admin_session: who ? { admin_id: who, token: TOKEN } : undefined });
const asOld = (who, body) => post(old, { ...body, admin_session: who ? { admin_id: who, token: TOKEN } : undefined });

/** Assert the new code blocks it, and record what the old code did. */
async function blocked(label, who, body, expectedStatus = 403) {
  const now = await as(who, body);
  const before = await asOld(who, body);
  expect(`${label} → ${expectedStatus} (было ${before.status})`,
    now.status === expectedStatus,
    `получили ${now.status}`);
}

section('эскалация привилегий (пункт 6)');
await blocked('content читает admin_accounts', 'id-content', { action: 'select', table: 'admin_accounts' });
await blocked('seller делает себя super_admin', 'id-seller',
  { action: 'update', table: 'admin_accounts', id: 'id-seller', data: { role: 'super_admin' } });
await blocked('manager правит сотрудников', 'id-manager',
  { action: 'update', table: 'admin_accounts', id: 'id-seller', data: { role: 'admin' } });
await blocked('admin выдаёт роль выше своей', 'id-admin',
  { action: 'insert', table: 'admin_accounts', data: { email: 'x@x.uz', role: 'super_admin', password: 'longenough1' } });
await blocked('admin меняет собственную роль', 'id-admin',
  { action: 'update', table: 'admin_accounts', id: 'id-admin', data: { role: 'super_admin' } });
await blocked('admin удаляет себя', 'id-admin', { action: 'delete', table: 'admin_accounts', id: 'id-admin' });

section('разделение обязанностей (пункт 6)');
await blocked('seller правит заказы', 'id-seller', { action: 'update', table: 'orders', id: 'o1', data: {} });
await blocked('content правит купоны', 'id-content', { action: 'update', table: 'coupons', id: 'c1', data: {} });
await blocked('support правит товары', 'id-support', { action: 'update', table: 'products', id: 'p1', data: {} });
await blocked('manager читает журнал аудита', 'id-manager', { action: 'select', table: 'audit_log' });
await blocked('seller читает favorites', 'id-seller', { action: 'select', table: 'favorites' });
await blocked('запрос без сессии', null, { action: 'select', table: 'products' }, 401);

section('легитимные операции');
for (const [label, who, body] of [
  ['seller правит товары', 'id-seller', { action: 'update', table: 'products', id: 'p1', data: { price: 1 } }],
  ['content правит баннеры', 'id-content', { action: 'update', table: 'banners', id: 'b1', data: {} }],
  ['support меняет статус заказа', 'id-support', { action: 'updateOrderStatus', id: 'o1', data: { status: 'shipping' } }],
  ['admin читает журнал аудита', 'id-admin', { action: 'select', table: 'audit_log' }],
]) {
  const r = await as(who, body);
  expect(`${label} → 200`, r.status === 200, `получили ${r.status} ${(await r.text()).slice(0, 60)}`);
}

section('учётные данные не покидают функцию (пункт 6)');
const listing = await as('id-super', { action: 'select', table: 'admin_accounts' });
const listingBody = JSON.stringify(await listing.json());
expect('ответ без password_hash и session_token',
  !listingBody.includes(SECRET_HASH) && !listingBody.includes(TOKEN_HASH));
const oldListing = JSON.stringify(await (await asOld('id-content', { action: 'select', table: 'admin_accounts' })).json());
expect('старый код отдавал их контент-менеджеру',
  oldListing.includes(SECRET_HASH) || oldListing.includes(TOKEN_HASH));

section('пароли хеширует база (пункт 8)');
let res = await as('id-super', { action: 'update', table: 'admin_accounts', id: 'id-manager', data: { password_hash: '$2a$10$STOLEN' } });
expect('готовый password_hash от клиента отклонён (pass-the-hash)', res.status === 403, `получили ${res.status}`);

res = await as('id-super', { action: 'update', table: 'admin_accounts', id: 'id-manager', data: { password: 'short' } });
expect('короткий пароль отклонён', res.status === 400, `получили ${res.status}`);

res = await as('id-super', { action: 'insert', table: 'admin_accounts', data: { email: 'n@x.uz', role: 'manager' } });
expect('новый аккаунт без пароля отклонён', res.status === 400, `получили ${res.status}`);

calls.rpc.length = 0; calls.writes.length = 0;
res = await as('id-super', { action: 'update', table: 'admin_accounts', id: 'id-manager', data: { password: 'brandNewPassw0rd' } });
const hashCall = calls.rpc.find((c) => c.fn === 'hash_admin_password');
const write = calls.writes.find((w) => w.table === 'admin_accounts');
expect('пароль ушёл в БД на хеширование', res.status === 200 && hashCall?.args?.p_password === 'brandNewPassw0rd',
  JSON.stringify(hashCall?.args));
expect('в таблицу записан хеш, а не пароль',
  write?.payload?.password_hash?.startsWith('$2a$10$') && !('password' in (write?.payload ?? {})),
  JSON.stringify(write?.payload));

calls.rpc.length = 0; calls.writes.length = 0;
res = await as('id-super', { action: 'update', table: 'admin_accounts', id: 'id-manager', data: { first_name: 'X', password: '' } });
expect('пустой пароль не трогает текущий',
  res.status === 200 && !calls.rpc.some((c) => c.fn === 'hash_admin_password')
  && !('password_hash' in (calls.writes.find((w) => w.table === 'admin_accounts')?.payload ?? {})));

section('массовые операции по фильтру недоступны (пункт 15)');

// `filters: {}` is truthy, so the old magic-id branches built a statement with
// no WHERE clause: one request wiped or rewrote an entire table.
for (const [label, body] of [
  ['удаление всех товаров через id "__filter__"',
    { action: 'delete', table: 'products', id: '__filter__', filters: {} }],
  ['удаление через фильтры в data (исходный дефект)',
    { action: 'delete', table: 'favorites', id: '__filter__', data: { telegram_user_id: 1 } }],
  ['отмена всех заказов через id "__bulk__"',
    { action: 'update', table: 'orders', id: '__bulk__', filters: {}, data: { status: 'cancelled' } }],
]) {
  calls.writes.length = 0;
  const now = await as('id-super', body);
  const nowWrote = calls.writes.length;
  calls.writes.length = 0;
  const beforeRes = await asOld('id-super', body);
  const beforeWrote = calls.writes.length;
  expect(`${label} — отклонено, 0 операций (старый код: ${beforeRes.status}, операций ${beforeWrote})`,
    now.status === 400 && nowWrote === 0,
    `новый код: статус ${now.status}, операций ${nowWrote}`);
}

// A normal, id-scoped delete must keep working.
calls.writes.length = 0;
const single = await as('id-super', { action: 'delete', table: 'products', id: 'p1' });
expect('обычное удаление по id работает', single.status === 200 && calls.writes.some((w) => w.op === 'delete'),
  `статус ${single.status}`);

section('updateOrderStatus не падает на thenable (пункт 9)');
const nowStatus = await as('id-super', { action: 'updateOrderStatus', table: 'orders', id: 'o1', data: { status: 'shipping' } });
const oldStatus = await asOld('id-super', { action: 'updateOrderStatus', table: 'orders', id: 'o1', data: { status: 'shipping' } });
expect(`успешная смена статуса → 200 (старый код: ${oldStatus.status})`,
  nowStatus.status === 200 && oldStatus.status === 500,
  `новый ${nowStatus.status}, старый ${oldStatus.status}`);
