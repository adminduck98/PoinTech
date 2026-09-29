/**
 * Coupon validation, shared by checkout (which applies the discount) and
 * client-api (which previews it for the cart screen).
 *
 * It lives here because the two used to disagree: the browser validated coupons
 * itself, but its usage-limit queries ran as `anon`, where RLS denies
 * coupon_usage and orders — so every count came back 0 and every limit silently
 * passed. A customer could see "coupon applied" for a coupon that was exhausted,
 * or reuse a one-per-customer coupon forever.
 */

/**
 * Minimal shape of the Supabase client this module needs. Typing it structurally
 * avoids importing supabase-js here (and avoids `any`), while still catching
 * typos in the query chain.
 */
interface CountResult { count: number | null }
interface SingleResult<T> { data: T | null }

interface CouponQuery {
  select(columns: string): CouponQuery;
  eq(column: string, value: unknown): CouponQuery;
  maybeSingle(): Promise<SingleResult<Coupon & { is_active: boolean }>>;
}

interface CountQuery {
  select(columns: string, opts: { count: "exact"; head: true }): CountQuery;
  eq(column: string, value: unknown): CountQuery;
  then<R>(onfulfilled: (value: CountResult) => R): Promise<R>;
}

interface SupabaseLike {
  from(table: "coupons"): CouponQuery;
  from(table: "coupon_usage" | "orders"): CountQuery;
  from(table: string): CouponQuery & CountQuery;
}

export interface Coupon {
  id: string;
  code: string;
  type: "percent" | "fixed";
  value: number;
  min_order_amount: number;
  max_uses_total: number | null;
  max_uses_per_user: number | null;
  valid_from: string;
  valid_until: string | null;
  new_customers_only: boolean;
}

export interface CouponResult {
  valid: boolean;
  coupon: Coupon | null;
  discount: number;
  error: string | null;
}

function fail(error: string, coupon: Coupon | null = null): CouponResult {
  return { valid: false, coupon, discount: 0, error };
}

/**
 * Validate a coupon for a given customer and cart subtotal.
 *
 * Look the coupon up either by `code` (cart preview) or by `couponId`
 * (checkout, where the id was already chosen). All checks run with the caller's
 * client — pass a service_role client so RLS cannot hide usage rows.
 */
export async function validateCoupon(
  supabase: SupabaseLike,
  params: {
    code?: string;
    couponId?: string;
    telegramUserId: number;
    subtotal: number;
  },
): Promise<CouponResult> {
  const { code, couponId, telegramUserId, subtotal } = params;

  if (!code && !couponId) return fail("Coupon is required");

  let query = supabase
    .from("coupons")
    .select("id, code, type, value, min_order_amount, max_uses_total, max_uses_per_user, valid_from, valid_until, new_customers_only, is_active")
    .eq("is_active", true);

  query = couponId
    ? query.eq("id", couponId)
    : query.eq("code", String(code).trim().toUpperCase());

  const { data: coupon } = await query.maybeSingle();
  if (!coupon) return fail("Купон не найден");

  const now = new Date();
  if (coupon.valid_until && new Date(coupon.valid_until) < now) {
    return fail("Купон истёк", coupon);
  }
  if (new Date(coupon.valid_from) > now) {
    return fail("Купон ещё не активен", coupon);
  }
  if (subtotal < Number(coupon.min_order_amount)) {
    return fail(`Минимальная сумма заказа: ${coupon.min_order_amount}`, coupon);
  }

  if (coupon.max_uses_total !== null) {
    const { count } = await supabase
      .from("coupon_usage")
      .select("id", { count: "exact", head: true })
      .eq("coupon_id", coupon.id);
    if ((count ?? 0) >= Number(coupon.max_uses_total)) {
      return fail("Купон закончился", coupon);
    }
  }

  const perUserLimit = Number(coupon.max_uses_per_user ?? 1);
  if (perUserLimit > 0) {
    const { count } = await supabase
      .from("coupon_usage")
      .select("id", { count: "exact", head: true })
      .eq("coupon_id", coupon.id)
      .eq("telegram_user_id", telegramUserId);
    if ((count ?? 0) >= perUserLimit) {
      return fail("Вы уже использовали этот купон", coupon);
    }
  }

  if (coupon.new_customers_only) {
    const { count } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("telegram_user_id", telegramUserId);
    if ((count ?? 0) > 0) {
      return fail("Купон только для новых клиентов", coupon);
    }
  }

  const discount = coupon.type === "percent"
    ? Math.round(subtotal * Number(coupon.value) / 100)
    : Math.min(Number(coupon.value), subtotal);

  return { valid: true, coupon, discount, error: null };
}
