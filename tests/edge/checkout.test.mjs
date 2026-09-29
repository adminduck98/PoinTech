/**
 * checkout: the order total is computed from the database, never taken from
 * the request (item 7), with coupon rules shared with the cart preview (11).
 *
 * The pre-fix version skipped identity verification whenever init_data was
 * absent, so it is exercised that way to isolate the money logic from item 1.
 */
import {
  loadFunction, fromGitHead, installDenoEnv, makeSupabaseStub, installFetchStub, signInitData, post,
} from '../helpers/edge.mjs';

const expect = globalThis.__EXPECT__;
const section = globalThis.__SECTION__;

const BOT_TOKEN = '123456:TEST-token-not-real';
const USER = { id: 5720497431, first_name: 'Aziz' };
const INIT_DATA = signInitData(BOT_TOKEN, {
  user: JSON.stringify(USER), auth_date: String(Math.floor(Date.now() / 1000)),
});

installDenoEnv({
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
});

const PRODUCTS = [
  { id: 'p1', name: { ru: 'Куртка', uz: 'Kurtka' }, price: 500000, stock: 10, is_active: true, images: ['a.jpg'] },
  { id: 'p2', name: { ru: 'Шапка', uz: 'Shapka' }, price: 120000, stock: 2, is_active: true, images: ['b.jpg'] },
  { id: 'p3', name: { ru: 'Снятый', uz: '-' }, price: 90000, stock: 5, is_active: false, images: [] },
];
const ZONES = [
  { id: 'z1', standard_price: 20000, express_price: 45000, free_threshold: 1000000, is_active: true },
  { id: 'z-off', standard_price: 20000, express_price: 45000, free_threshold: null, is_active: false },
];
let coupons = [];
let couponUsage = [];
let pastOrders = [];
let lastOrder = null;

makeSupabaseStub({
  tables: {
    products: PRODUCTS,
    delivery_zones: ZONES,
    coupons: () => coupons,
    coupon_usage: () => couponUsage,
    orders: () => pastOrders,
  },
  rpc: {
    create_order_with_stock: (args) => {
      lastOrder = args;
      return { data: [{ id: 'order-1', status: args.p_status, total_amount: args.p_total_amount }], error: null };
    },
  },
});
installFetchStub();

const checkout = await loadFunction('checkout');
const old = await loadFunction(fromGitHead('supabase/functions/checkout/index.ts'));

const BASE = {
  customer_info: { name: 'Aziz', phone: '+998901112233', city: 'Ташкент', address: 'ул. 1', zone_id: 'z1' },
  delivery_type: 'standard', delivery_cost: 20000, payment_method: 'cash',
};
const buy = (body) => post(checkout, { init_data: INIT_DATA, ...BASE, ...body });
// Old version: no init_data → it skipped verification entirely.
const buyOld = (body) => post(old, { telegram_user_id: USER.id, ...BASE, ...body });

section('сумма считается на сервере (пункт 7)');

const underpay = { items: [{ productId: 'p1', name: 'x', price: 500000, quantity: 1 }], total_amount: 1 };

lastOrder = null;
let res = await buy(underpay);
const createdByNew = lastOrder;

lastOrder = null;
let before = await buyOld(underpay);
const createdByOld = lastOrder;

expect(`заказ на 500000 с total_amount: 1 отклонён (старый код: ${before.status})`,
  res.status === 409 && before.status === 200, `новый ${res.status}, старый ${before.status}`);
expect('новый код заказ не создал', createdByNew === null, JSON.stringify(createdByNew)?.slice(0, 60));
expect(`старый код создавал заказ на сумму ${createdByOld?.p_total_amount}`,
  createdByOld?.p_total_amount === 1, JSON.stringify(createdByOld?.p_total_amount));

lastOrder = null;
res = await buy({ items: [{ productId: 'p1', name: 'x', price: 500000, quantity: 1 }], total_amount: 520000 });
expect('честный заказ: 500000 + 20000 доставка = 520000',
  res.status === 200 && lastOrder?.p_total_amount === 520000, `${res.status}, ${lastOrder?.p_total_amount}`);

res = await buy({ items: [{ productId: 'p1', name: 'x', price: 1, quantity: 1 }], total_amount: 21000 });
expect('подделанная цена позиции отклонена', res.status === 409, `получили ${res.status}`);

res = await buy({
  customer_info: { ...BASE.customer_info, zone_id: undefined }, delivery_cost: -400000,
  items: [{ productId: 'p1', name: 'x', price: 500000, quantity: 1 }], total_amount: 100000,
});
expect('отрицательная доставка не уменьшает итог', res.status === 409, `получили ${res.status}`);

section('доставка берётся из зоны');

lastOrder = null;
res = await buy({ items: [{ productId: 'p1', name: 'x', price: 500000, quantity: 2 }], total_amount: 1000000 });
expect('бесплатная доставка выше порога', res.status === 200 && lastOrder?.p_delivery_cost === 0,
  `${res.status}, доставка ${lastOrder?.p_delivery_cost}`);

lastOrder = null;
res = await buy({ delivery_type: 'express', delivery_cost: 0,
  items: [{ productId: 'p2', name: 'x', price: 120000, quantity: 1 }], total_amount: 165000 });
expect('экспресс-цена из зоны (45000), а не от клиента (0)',
  res.status === 200 && lastOrder?.p_delivery_cost === 45000, `${res.status}, ${lastOrder?.p_delivery_cost}`);

res = await buy({ customer_info: { ...BASE.customer_info, zone_id: 'z-off' },
  items: [{ productId: 'p2', name: 'x', price: 120000, quantity: 1 }], total_amount: 140000 });
expect('отключённая зона отклонена', res.status === 400, `получили ${res.status}`);

section('склад и состав заказа');

res = await buy({ items: [
  { productId: 'p2', name: 'x', price: 120000, quantity: 2, size: 'M' },
  { productId: 'p2', name: 'x', price: 120000, quantity: 2, size: 'L' },
], total_amount: 500000 });
expect('остаток проверен по сумме дублирующихся строк', res.status === 400, `получили ${res.status}`);

res = await buy({ items: [{ productId: 'p3', name: 'x', price: 90000, quantity: 1 }], total_amount: 110000 });
expect('снятый с продажи товар отклонён', res.status === 400, `получили ${res.status}`);

lastOrder = null;
await buy({ items: [{ productId: 'p1', name: 'ПОДДЕЛКА', price: 500000, quantity: 1 }], total_amount: 520000 });
expect('название позиции взято из БД', lastOrder?.p_items?.[0]?.name?.ru === 'Куртка',
  JSON.stringify(lastOrder?.p_items?.[0]?.name));

section('купоны — общий модуль с превью корзины (пункты 7 и 11)');

coupons = [{
  id: 'c1', code: 'SALE10', type: 'percent', value: 10, min_order_amount: 0, is_active: true,
  valid_from: '2020-01-01', valid_until: null, max_uses_total: null, max_uses_per_user: 1,
  new_customers_only: false,
}];
const withCoupon = { coupon_id: 'c1', items: [{ productId: 'p1', name: 'x', price: 500000, quantity: 1 }], total_amount: 470000 };

couponUsage = [{ id: 'u1', coupon_id: 'c1', telegram_user_id: USER.id }];
res = await buy(withCoupon);
before = await buyOld(withCoupon);
expect(`повторное использование отклонено (старый код: ${before.status})`,
  res.status === 400 && before.status === 200, `новый ${res.status}, старый ${before.status}`);

couponUsage = [{ id: 'u1', coupon_id: 'c1', telegram_user_id: 1 }, { id: 'u2', coupon_id: 'c1', telegram_user_id: 2 }];
coupons[0].max_uses_total = 2; coupons[0].max_uses_per_user = 5;
res = await buy(withCoupon);
expect('исчерпанный общий лимит отклонён', res.status === 400, `получили ${res.status}`);

couponUsage = []; coupons[0].max_uses_total = null; coupons[0].new_customers_only = true;
pastOrders = [{ id: 'old', telegram_user_id: USER.id }];
res = await buy(withCoupon);
expect('«только для новых» у старого клиента отклонён', res.status === 400, `получили ${res.status}`);

pastOrders = []; coupons[0].new_customers_only = false; lastOrder = null;
res = await buy(withCoupon);
expect('валидный купон: скидка 50000, итог 470000',
  res.status === 200 && lastOrder?.p_discount_amount === 50000 && lastOrder?.p_total_amount === 470000,
  `${res.status}, скидка ${lastOrder?.p_discount_amount}, итог ${lastOrder?.p_total_amount}`);

section('идентичность (пункт 1)');
res = await post(checkout, { ...BASE, items: [{ productId: 'p1', name: 'x', price: 500000, quantity: 1 }], total_amount: 520000 });
expect('без initData оформление невозможно', res.status === 401, `получили ${res.status}`);
