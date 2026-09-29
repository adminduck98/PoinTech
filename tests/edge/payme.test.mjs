/**
 * payme-callback: Merchant API conformance (item 16).
 *
 * Payme's certification exercises the JSON-RPC state machine and checks the
 * specific error codes, so the assertions below mirror what it looks for.
 * The pre-fix version is loaded alongside to show what it answered.
 */
import {
  loadFunction, fromGitHead, installDenoEnv, makeSupabaseStub, installFetchStub,
} from '../helpers/edge.mjs';

const expect = globalThis.__EXPECT__;
const section = globalThis.__SECTION__;

const MERCHANT_KEY = 'payme-merchant-key';
const ORDER_ID = 'a0000000-0000-0000-0000-000000000001';
const ORDER_TOTAL = 500000;            // so'm
const AMOUNT_TIYIN = ORDER_TOTAL * 100;

installDenoEnv({
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  PAYME_MERCHANT_KEY: MERCHANT_KEY,
  TELEGRAM_BOT_TOKEN: 'bot-token',
  ADMIN_TELEGRAM_ID: '1',
});

let orders = [];
let transactions = [];
let products = [];

const calls = makeSupabaseStub({
  tables: {
    orders: () => orders,
    payme_transactions: () => transactions,
    products: () => products,
  },
  rpc: {
    adjust_stock: (args) => {
      const p = products.find((x) => x.id === args.p_product_id);
      if (p) p.stock += args.p_delta;
      return { data: { stock: p?.stock }, error: null };
    },
  },
});
installFetchStub();

// The stub is read-only, so mirror writes into the fixtures by hand.
const realFrom = globalThis.__SUPABASE__.from;
globalThis.__SUPABASE__.from = (table) => {
  const b = realFrom(table);
  const origInsert = b.insert;
  const origUpdate = b.update;
  let filters = {};
  const origEq = b.eq;
  b.eq = (k, v) => { filters[k] = v; return origEq(k, v); };
  b.insert = (payload) => {
    if (table === 'payme_transactions') {
      transactions.push({
        id: `tx-${transactions.length + 1}`, perform_time: 0, cancel_time: 0,
        reason: null, ...payload,
      });
    }
    return origInsert(payload);
  };
  b.update = (payload) => {
    const target = table === 'payme_transactions' ? transactions : table === 'orders' ? orders : products;
    queueMicrotask(() => {
      for (const row of target) {
        if (Object.entries(filters).every(([k, v]) => k === 'state' ? true : row[k] === v)) {
          Object.assign(row, payload);
        }
      }
    });
    return origUpdate(payload);
  };
  return b;
};

const payme = await loadFunction('payme-callback');
const old = await loadFunction(fromGitHead('supabase/functions/payme-callback/index.ts'));

const auth = 'Basic ' + Buffer.from(`Paycom:${MERCHANT_KEY}`).toString('base64');

function call(handler, method, params, headers = { Authorization: auth }) {
  return handler(new Request('https://test.local/payme-callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ method, params, id: 1 }),
  }));
}
const rpc = (method, params, headers) => call(payme, method, params, headers);
const rpcOld = (method, params, headers) => call(old, method, params, headers);

async function body(res) { return res.json(); }

function reset() {
  orders = [{ id: ORDER_ID, total_amount: ORDER_TOTAL, status: 'processing', items: [{ productId: 'p1', quantity: 2 }] }];
  transactions = [];
  products = [{ id: 'p1', stock: 5 }];
}

// ── Authentication ──────────────────────────────────────────────────────────
section('аутентификация');
reset();
let res = await rpc('CheckPerformTransaction', { account: { order_id: ORDER_ID }, amount: AMOUNT_TIYIN }, {});
let b = await body(res);
expect('без Basic-заголовка → -32504', b.error?.code === -32504, JSON.stringify(b));

res = await rpc('CheckPerformTransaction', { account: { order_id: ORDER_ID }, amount: AMOUNT_TIYIN },
  { Authorization: 'Basic ' + Buffer.from('Paycom:wrong-key').toString('base64') });
b = await body(res);
expect('неверный ключ мерчанта → -32504', b.error?.code === -32504, JSON.stringify(b));

expect('ответ всегда HTTP 200 (ошибка в теле)', res.status === 200, `получили ${res.status}`);

// ── Error codes ─────────────────────────────────────────────────────────────
section('коды ошибок протокола');
reset();
res = await rpc('CheckPerformTransaction', { account: { order_id: 'b0000000-0000-0000-0000-0000000000ff' }, amount: AMOUNT_TIYIN });
b = await body(res);
const oldMissing = await body(await rpcOld('CheckPerformTransaction', { account: { order_id: 'nope' }, amount: AMOUNT_TIYIN }));
expect(`несуществующий заказ → -31050 (старый код: ${oldMissing.error?.code})`,
  b.error?.code === -31050, JSON.stringify(b));
expect('в ошибке указано поле account', b.error?.data === 'order_id', JSON.stringify(b.error));

reset();
res = await rpc('CheckPerformTransaction', { account: { order_id: ORDER_ID }, amount: 1 });
b = await body(res);
const oldAmount = await body(await rpcOld('CheckPerformTransaction', { account: { order_id: ORDER_ID }, amount: 1 }));
expect(`неверная сумма → -31001 (старый код: ${oldAmount.error?.code})`, b.error?.code === -31001, JSON.stringify(b));

res = await rpc('NoSuchMethod', {});
b = await body(res);
expect('неизвестный метод → -32601', b.error?.code === -32601, JSON.stringify(b));

expect('сообщения локализованы (ru/uz/en)',
  typeof b.error?.message?.ru === 'string' && typeof b.error?.message?.uz === 'string' && typeof b.error?.message?.en === 'string',
  JSON.stringify(b.error?.message));

// ── Happy path ──────────────────────────────────────────────────────────────
section('нормальный сценарий оплаты');
reset();
res = await rpc('CheckPerformTransaction', { account: { order_id: ORDER_ID }, amount: AMOUNT_TIYIN });
b = await body(res);
expect('CheckPerformTransaction → allow', b.result?.allow === true, JSON.stringify(b));

const NOW = Date.now();
res = await rpc('CreateTransaction', { id: 'pm-1', time: NOW, account: { order_id: ORDER_ID }, amount: AMOUNT_TIYIN });
b = await body(res);
const createTime = b.result?.create_time;
expect('CreateTransaction → state 1', b.result?.state === 1, JSON.stringify(b));
expect('create_time — время транзакции, а не заказа', createTime === NOW, `= ${createTime}`);

const replay = await body(await rpc('CreateTransaction', { id: 'pm-1', time: NOW, account: { order_id: ORDER_ID }, amount: AMOUNT_TIYIN }));
expect('повторный CreateTransaction идемпотентен',
  replay.result?.transaction === b.result?.transaction && replay.result?.create_time === createTime,
  JSON.stringify(replay));

res = await rpc('PerformTransaction', { id: 'pm-1' });
b = await body(res);
expect('PerformTransaction → state 2', b.result?.state === 2, JSON.stringify(b));
expect('заказ помечен оплаченным', orders[0].status === 'paid', orders[0].status);

const performReplay = await body(await rpc('PerformTransaction', { id: 'pm-1' }));
expect('повторный PerformTransaction идемпотентен',
  performReplay.result?.state === 2 && performReplay.result?.perform_time === b.result?.perform_time,
  JSON.stringify(performReplay));

res = await rpc('CheckTransaction', { id: 'pm-1' });
b = await body(res);
expect('CheckTransaction отдаёт все три времени',
  b.result?.create_time === NOW && b.result?.perform_time > 0 && b.result?.cancel_time === 0,
  JSON.stringify(b.result));

// ── Cancellation after payment returns stock ────────────────────────────────
section('отмена после оплаты');
const stockBefore = products[0].stock;
res = await rpc('CancelTransaction', { id: 'pm-1', reason: 5 });
b = await body(res);
await new Promise((r) => setTimeout(r, 10));
expect('отмена оплаченной транзакции → state -2', b.result?.state === -2, JSON.stringify(b));
expect(`товар возвращён на склад (${stockBefore} → ${products[0].stock})`,
  products[0].stock === stockBefore + 2, `было ${stockBefore}, стало ${products[0].stock}`);

const cancelReplay = await body(await rpc('CancelTransaction', { id: 'pm-1', reason: 5 }));
expect('повторная отмена идемпотентна и склад не растёт дважды',
  cancelReplay.result?.state === -2 && products[0].stock === stockBefore + 2,
  `state ${cancelReplay.result?.state}, склад ${products[0].stock}`);

// ── Cancellation before payment must NOT touch stock ────────────────────────
section('отмена до оплаты');
reset();
await rpc('CreateTransaction', { id: 'pm-2', time: Date.now(), account: { order_id: ORDER_ID }, amount: AMOUNT_TIYIN });
const stockBeforeUnpaid = products[0].stock;
b = await body(await rpc('CancelTransaction', { id: 'pm-2', reason: 3 }));
await new Promise((r) => setTimeout(r, 10));
expect('неоплаченная транзакция → state -1', b.result?.state === -1, JSON.stringify(b));
expect('склад не изменился', products[0].stock === stockBeforeUnpaid,
  `было ${stockBeforeUnpaid}, стало ${products[0].stock}`);

// ── 12-hour timeout ─────────────────────────────────────────────────────────
section('таймаут транзакции (12 часов)');
reset();
const STALE = Date.now() - 13 * 60 * 60 * 1000;
await rpc('CreateTransaction', { id: 'pm-3', time: STALE, account: { order_id: ORDER_ID }, amount: AMOUNT_TIYIN });
b = await body(await rpc('PerformTransaction', { id: 'pm-3' }));
await new Promise((r) => setTimeout(r, 10));
expect('оплата просроченной транзакции отклонена → -31008', b.error?.code === -31008, JSON.stringify(b));
b = await body(await rpc('CheckTransaction', { id: 'pm-3' }));
expect('она отменена с reason 4', b.result?.state === -1 && b.result?.reason === 4, JSON.stringify(b.result));

// ── Unknown transaction ─────────────────────────────────────────────────────
section('прочее');
b = await body(await rpc('CheckTransaction', { id: 'does-not-exist' }));
expect('неизвестная транзакция → -31003', b.error?.code === -31003, JSON.stringify(b));

b = await body(await rpc('GetStatement', { from: 0, to: Date.now() + 1000 }));
expect('GetStatement возвращает список транзакций', Array.isArray(b.result?.transactions), JSON.stringify(b).slice(0, 80));
