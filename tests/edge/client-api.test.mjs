/**
 * client-api: identity verification, per-user isolation, and the customer
 * writes that used to go through the always-401 publicApiCall path.
 */
import {
  loadFunction, installDenoEnv, makeSupabaseStub, installFetchStub, signInitData, post,
} from '../helpers/edge.mjs';

const expect = globalThis.__EXPECT__;
const section = globalThis.__SECTION__;

const BOT_TOKEN = '123456:TEST-token-not-real';
const USER = { id: 5720497431, first_name: 'Aziz', username: 'aziz' };
const OTHER_USER_ID = 111222333;
const INIT_DATA = signInitData(BOT_TOKEN, {
  user: JSON.stringify(USER),
  auth_date: String(Math.floor(Date.now() / 1000)),
});

installDenoEnv({
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  ADMIN_TELEGRAM_ID: '5720497431',
});

const COUPONS = [{
  id: 'c1', code: 'SALE10', type: 'percent', value: 10, min_order_amount: 0,
  is_active: true, valid_from: '2020-01-01', valid_until: null,
  max_uses_total: null, max_uses_per_user: 1, new_customers_only: false,
}];
let couponUsage = [];

const calls = makeSupabaseStub({
  tables: {
    users: [{ id: 'u1', telegram_id: USER.id, first_name: 'Aziz', phone: '+998901112233', address: 'ул. 1' }],
    notifications: [
      { id: 'n1', telegram_user_id: USER.id, is_read: false, title: 'своё-1' },
      { id: 'n2', telegram_user_id: USER.id, is_read: true, title: 'своё-2' },
      { id: 'n3', telegram_user_id: OTHER_USER_ID, is_read: false, title: 'ЧУЖОЕ' },
    ],
    returns: [
      { id: 'r1', telegram_user_id: USER.id },
      { id: 'r2', telegram_user_id: OTHER_USER_ID },
    ],
    orders: [
      { id: 'order-mine', telegram_user_id: USER.id },
      { id: 'order-foreign', telegram_user_id: OTHER_USER_ID },
    ],
    coupons: COUPONS,
    coupon_usage: () => couponUsage,
  },
  rpc: {
    insert_review: { data: { id: 'rev1' }, error: null },
    insert_return: { data: { id: 'ret1' }, error: null },
    upsert_user: { data: { id: 'u1' }, error: null },
    record_coupon_usage: { data: null, error: null },
    add_favorite: { data: null, error: null },
    get_client_orders: { data: [{ id: 'order-mine' }], error: null },
    get_client_favorites: { data: [], error: null },
    get_order_messages: { data: [{ id: 'm1', content: 'привет' }], error: null },
    send_message: { data: { id: 'm2' }, error: null },
    mark_messages_read: { data: null, error: null },
    get_unread_message_count: { data: 3, error: null },
  },
});
installFetchStub();

const api = await loadFunction('client-api');
const call = (action, params = {}, initData = INIT_DATA) =>
  post(api, { action, ...(initData ? { init_data: initData } : {}), ...params });

// ── Identity ────────────────────────────────────────────────────────────────
section('идентичность обязательна и берётся из initData');

let res = await call('get_client_orders', { p_telegram_user_id: USER.id }, null);
expect('без initData — 401', res.status === 401, `получили ${res.status}`);

res = await call('get_client_orders', { p_telegram_user_id: USER.id }, 'user=%7B%22id%22%3A1%7D&auth_date=1&hash=deadbeef');
expect('поддельные initData — 401', res.status === 401, `получили ${res.status}`);

calls.rpc.length = 0;
res = await call('get_client_orders', { p_telegram_user_id: OTHER_USER_ID });
const ordersCall = calls.rpc.find((c) => c.fn === 'get_client_orders');
expect('подменённый telegram_user_id игнорируется',
  res.status === 200 && ordersCall?.args?.p_telegram_user_id === USER.id,
  `в RPC ушёл ${ordersCall?.args?.p_telegram_user_id}`);

// ── Admin-only actions ──────────────────────────────────────────────────────
// insert_notification pushes a notification to an arbitrary user, so it is
// gated on an admin session rather than on initData. Worth its own case: the
// gate reads a result object, and a truthiness check would let everyone past.
section('действия только для админа');

res = await call('insert_notification', {
  p_telegram_user_id: USER.id, p_type: 'promo', p_title: 'T', p_body: 'B',
});
expect('insert_notification без админской сессии — 401', res.status === 401, `получили ${res.status}`);

res = await post(api, {
  action: 'insert_notification',
  admin_session: { admin_id: 'nobody', token: 'wrong' },
  p_telegram_user_id: USER.id, p_type: 'promo', p_title: 'T', p_body: 'B',
});
expect('insert_notification с недействительной сессией — 401', res.status === 401, `получили ${res.status}`);

// ── Per-user isolation on the reads restored in item 11 ─────────────────────
section('чтения, которые RLS молча обнуляла (пункт 11)');

res = await call('get_user_profile', { p_telegram_user_id: USER.id });
let body = await res.json();
expect('профиль возвращается', res.status === 200 && body?.phone === '+998901112233', JSON.stringify(body).slice(0, 60));

res = await call('get_notifications', { p_telegram_user_id: USER.id });
body = await res.json();
expect('уведомления только свои', res.status === 200 && body.length === 2 && !JSON.stringify(body).includes('ЧУЖОЕ'),
  JSON.stringify(body).slice(0, 80));

res = await call('get_unread_notification_count', { p_telegram_user_id: USER.id });
body = await res.json();
expect('счётчик непрочитанных = 1', res.status === 200 && body === 1, `= ${JSON.stringify(body)}`);

res = await call('get_user_returns', { p_telegram_user_id: USER.id });
body = await res.json();
expect('возвраты только свои', res.status === 200 && body.length === 1 && body[0].id === 'r1',
  JSON.stringify(body).slice(0, 60));

// ── Order chat ownership ────────────────────────────────────────────────────
section('чат заказа ограничен своими заказами');

res = await call('get_order_messages', { p_order_id: 'order-foreign' });
expect('чужой заказ — 404', res.status === 404, `получили ${res.status}`);

res = await call('get_order_messages', { p_order_id: 'order-mine' });
expect('свой заказ читается', res.status === 200, `получили ${res.status}`);

calls.rpc.length = 0;
res = await call('send_message', { p_order_id: 'order-mine', p_content: 'вопрос', p_sender_type: 'admin' });
const sent = calls.rpc.find((c) => c.fn === 'send_message');
expect('клиент не может писать от имени admin',
  res.status === 200 && sent?.args?.p_sender_type === 'customer',
  `sender_type = ${sent?.args?.p_sender_type}`);

res = await call('send_message', { p_order_id: 'order-mine', p_content: '   ' });
expect('пустое сообщение отклонено', res.status === 400, `получили ${res.status}`);

// ── Coupon preview agrees with checkout ─────────────────────────────────────
section('превью купона (пункт 11)');

couponUsage = [];
res = await call('validate_coupon', { p_code: 'SALE10', p_subtotal: 500000 });
body = await res.json();
expect('скидка 10% = 50000', res.status === 200 && body.valid === true && body.discount === 50000,
  JSON.stringify(body).slice(0, 80));

couponUsage = [{ id: 'cu1', coupon_id: 'c1', telegram_user_id: USER.id }];
res = await call('validate_coupon', { p_code: 'SALE10', p_subtotal: 500000 });
body = await res.json();
expect('исчерпанный лимит виден в превью', res.status === 200 && body.valid === false,
  JSON.stringify(body).slice(0, 80));

// ── Item 14: customer writes formerly routed through publicApiCall ──────────
section('клиентские записи вместо publicApiCall (пункт 14)');

for (const [label, action, params] of [
  ['отзыв', 'insert_review', { p_product_id: 'p1', p_user_name: 'Aziz', p_rating: 5, p_comment: 'ок' }],
  ['заявка на возврат', 'insert_return', { p_order_id: 'order-mine', p_items: [], p_reason: 'брак' }],
  ['профиль (upsert)', 'upsert_user', { p_first_name: 'Aziz' }],
  ['использование купона', 'record_coupon_usage', { p_coupon_id: 'c1', p_order_id: 'order-mine' }],
]) {
  calls.rpc.length = 0;
  const r = await call(action, params);
  const rpcCall = calls.rpc.find((c) => c.fn === action);
  const id = rpcCall?.args?.p_telegram_user_id ?? rpcCall?.args?.p_telegram_id;
  expect(`${label}: принят и привязан к проверенному пользователю`,
    r.status === 200 && id === USER.id,
    `status ${r.status}, telegram id ${id}`);
}
