import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { notifyPaymentSuccess, notifyPaymentFailed } from "../_shared/telegram-notify.ts";
import { timingSafeEqual } from "../_shared/env.ts";

/**
 * Payme Merchant API endpoint (JSON-RPC over HTTPS).
 *
 * Notes on the rewrite:
 *
 *  * Every failure now answers with the error code the Merchant API defines.
 *    The previous version threw plain Errors that were flattened to -32400
 *    ("system error") — Payme's certification checks specific codes, e.g.
 *    -31001 for a wrong amount and -31050..-31099 for a bad account field, and
 *    -32400 for a missing order would fail it.
 *  * Transaction state lives in payme_transactions, not on the order, so the
 *    timestamps we report are the transaction's own and an admin cancelling an
 *    order in the dashboard no longer changes what we tell Payme.
 *  * Cancelling a performed transaction returns the reserved stock, which the
 *    old code never did — a refunded order silently kept the items deducted.
 *
 * NOTE: this endpoint must be deployed with verify_jwt = false (see
 * supabase/config.toml). Payme authenticates with HTTP Basic, and the platform
 * gateway would otherwise reject the request before this code runs.
 */

// ─── Merchant API error codes ────────────────────────────────────────────────
const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INSUFFICIENT_PRIVILEGE: -32504,
  WRONG_AMOUNT: -31001,
  TRANSACTION_NOT_FOUND: -31003,
  CANNOT_CANCEL: -31007,
  CANNOT_PERFORM: -31008,
  /** Account-field errors occupy -31050..-31099; this one flags `order_id`. */
  ORDER_NOT_FOUND: -31050,
  ORDER_NOT_PAYABLE: -31051,
} as const;

/** Payme expects localized messages. */
const MESSAGES: Record<number, { ru: string; uz: string; en: string }> = {
  [ERR.WRONG_AMOUNT]: { ru: "Неверная сумма", uz: "Noto'g'ri summa", en: "Incorrect amount" },
  [ERR.TRANSACTION_NOT_FOUND]: { ru: "Транзакция не найдена", uz: "Tranzaksiya topilmadi", en: "Transaction not found" },
  [ERR.CANNOT_CANCEL]: { ru: "Заказ доставлен, отмена невозможна", uz: "Buyurtma yetkazilgan, bekor qilib bo'lmaydi", en: "Order delivered, cannot cancel" },
  [ERR.CANNOT_PERFORM]: { ru: "Невозможно выполнить операцию", uz: "Amalni bajarib bo'lmaydi", en: "Unable to perform operation" },
  [ERR.ORDER_NOT_FOUND]: { ru: "Заказ не найден", uz: "Buyurtma topilmadi", en: "Order not found" },
  [ERR.ORDER_NOT_PAYABLE]: { ru: "Заказ не может быть оплачен", uz: "Buyurtmani to'lab bo'lmaydi", en: "Order is not payable" },
  [ERR.METHOD_NOT_FOUND]: { ru: "Метод не найден", uz: "Metod topilmadi", en: "Method not found" },
  [ERR.INVALID_REQUEST]: { ru: "Неверный запрос", uz: "Noto'g'ri so'rov", en: "Invalid request" },
  [ERR.PARSE]: { ru: "Ошибка разбора", uz: "Tahlil xatosi", en: "Parse error" },
  [ERR.INSUFFICIENT_PRIVILEGE]: { ru: "Недостаточно прав", uz: "Huquqlar yetarli emas", en: "Insufficient privilege" },
};

/** Transaction states, as defined by Payme. */
const STATE = { CREATED: 1, PERFORMED: 2, CANCELLED: -1, CANCELLED_AFTER_PERFORM: -2 } as const;

/** A transaction may sit unpaid for 12 hours before Payme expects a timeout. */
const TRANSACTION_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const TIMEOUT_REASON = 4;

class PaymeError extends Error {
  constructor(readonly code: number, readonly data?: string) {
    super(`Payme error ${code}`);
  }
}

interface PaymeParams {
  id?: string;
  account?: { order_id?: string };
  amount?: number;
  reason?: number;
  time?: number;
}

interface PaymeTransaction {
  id: string;
  payme_id: string;
  order_id: string;
  amount: number;
  state: number;
  reason: number | null;
  create_time: number;
  perform_time: number;
  cancel_time: number;
}

// Payme calls server-to-server; there is no browser origin to satisfy.
const JSON_HEADERS = { "Content-Type": "application/json" };

function rpcError(code: number, data?: string) {
  const message = MESSAGES[code] ?? { ru: "Ошибка", uz: "Xato", en: "Error" };
  // The Merchant API is always HTTP 200; the error travels in the body.
  return new Response(
    JSON.stringify({ error: { code, message, ...(data ? { data } : {}) } }),
    { status: 200, headers: JSON_HEADERS },
  );
}

function rpcResult(result: unknown, id: unknown) {
  return new Response(JSON.stringify({ result, id: id ?? null }), { status: 200, headers: JSON_HEADERS });
}

/**
 * Payme authenticates with HTTP Basic, login "Paycom", password = merchant key.
 * Compared in constant time — the previous `password === merchantKey` leaked
 * the key one byte at a time to an attacker able to measure response timing.
 */
function verifyPaymeAuth(req: Request): boolean {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;

  const merchantKey = Deno.env.get("PAYME_MERCHANT_KEY") ?? "";
  if (!merchantKey) return false;

  let decoded: string;
  try {
    decoded = atob(header.slice("Basic ".length));
  } catch {
    return false;
  }

  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  return timingSafeEqual(decoded.slice(separator + 1), merchantKey);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return rpcError(ERR.INVALID_REQUEST);
  }

  if (!verifyPaymeAuth(req)) {
    return rpcError(ERR.INSUFFICIENT_PRIVILEGE);
  }

  let payload: { method?: string; params?: PaymeParams; id?: unknown };
  try {
    payload = await req.json();
  } catch {
    return rpcError(ERR.PARSE);
  }

  const { method, params, id: rpcId } = payload;
  if (!method || !params) {
    return rpcError(ERR.INVALID_REQUEST);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    let result: unknown;
    switch (method) {
      case "CheckPerformTransaction": result = await checkPerformTransaction(params, supabase); break;
      case "CreateTransaction":       result = await createTransaction(params, supabase); break;
      case "PerformTransaction":      result = await performTransaction(params, supabase); break;
      case "CancelTransaction":       result = await cancelTransaction(params, supabase); break;
      case "CheckTransaction":        result = await checkTransaction(params, supabase); break;
      case "GetStatement":            result = await getStatement(params, supabase); break;
      default:
        return rpcError(ERR.METHOD_NOT_FOUND);
    }
    return rpcResult(result, rpcId);
  } catch (error) {
    if (error instanceof PaymeError) {
      return rpcError(error.code, error.data);
    }
    console.error("[Payme] unhandled error:", error);
    return rpcError(ERR.CANNOT_PERFORM);
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loadOrder(supabase: SupabaseClient, orderId: string | undefined) {
  if (!orderId || typeof orderId !== "string") {
    throw new PaymeError(ERR.ORDER_NOT_FOUND, "order_id");
  }
  const { data: order } = await supabase
    .from("orders")
    .select("id, total_amount, status, items")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) throw new PaymeError(ERR.ORDER_NOT_FOUND, "order_id");
  return order;
}

function assertAmountMatches(order: { total_amount: number }, amount: unknown) {
  const received = Number(amount);
  // orders.total_amount is in so'm; Payme works in tiyin.
  const expected = Math.round(Number(order.total_amount) * 100);
  if (!Number.isFinite(received) || received !== expected) {
    throw new PaymeError(ERR.WRONG_AMOUNT);
  }
  return expected;
}

function assertOrderPayable(order: { status: string }) {
  if (["paid", "cancelled", "delivered", "returned"].includes(order.status)) {
    throw new PaymeError(ERR.ORDER_NOT_PAYABLE, "order_id");
  }
}

async function findTransaction(supabase: SupabaseClient, paymeId: string | undefined) {
  if (!paymeId) throw new PaymeError(ERR.TRANSACTION_NOT_FOUND);
  const { data } = await supabase
    .from("payme_transactions")
    .select("*")
    .eq("payme_id", String(paymeId))
    .maybeSingle();
  if (!data) throw new PaymeError(ERR.TRANSACTION_NOT_FOUND);
  return data as PaymeTransaction;
}

/** Return reserved stock when a paid transaction is reversed. */
async function restoreStock(supabase: SupabaseClient, orderId: string) {
  const { data: order } = await supabase.from("orders").select("items").eq("id", orderId).maybeSingle();
  const items = Array.isArray(order?.items) ? order.items : [];

  for (const item of items as Array<{ productId?: string; quantity?: number }>) {
    if (!item?.productId || !item?.quantity) continue;
    const { error } = await supabase.rpc("adjust_stock", {
      p_product_id: item.productId,
      p_delta: Number(item.quantity),
    });
    if (error) {
      console.error(`[Payme] could not restore stock for ${item.productId}:`, error);
    }
  }
}

// ─── Merchant API methods ────────────────────────────────────────────────────

async function checkPerformTransaction(params: PaymeParams, supabase: SupabaseClient) {
  const order = await loadOrder(supabase, params.account?.order_id);
  assertOrderPayable(order);
  assertAmountMatches(order, params.amount);
  return { allow: true };
}

async function createTransaction(params: PaymeParams, supabase: SupabaseClient) {
  const paymeId = params.id ? String(params.id) : "";
  if (!paymeId) throw new PaymeError(ERR.TRANSACTION_NOT_FOUND);

  // Idempotent: replaying CreateTransaction must return the same transaction.
  const { data: existing } = await supabase
    .from("payme_transactions")
    .select("*")
    .eq("payme_id", paymeId)
    .maybeSingle();

  if (existing) {
    const tx = existing as PaymeTransaction;
    if (tx.state !== STATE.CREATED) throw new PaymeError(ERR.CANNOT_PERFORM);
    if (Date.now() - tx.create_time > TRANSACTION_TIMEOUT_MS) {
      await supabase.from("payme_transactions").update({
        state: STATE.CANCELLED, reason: TIMEOUT_REASON,
        cancel_time: Date.now(), updated_at: new Date().toISOString(),
      }).eq("id", tx.id);
      throw new PaymeError(ERR.CANNOT_PERFORM);
    }
    return { create_time: tx.create_time, transaction: tx.id, state: tx.state };
  }

  const order = await loadOrder(supabase, params.account?.order_id);
  assertOrderPayable(order);
  const amount = assertAmountMatches(order, params.amount);

  // Refuse a second live transaction for the same order.
  const { data: active } = await supabase
    .from("payme_transactions")
    .select("id")
    .eq("order_id", order.id)
    .in("state", [STATE.CREATED, STATE.PERFORMED])
    .maybeSingle();
  if (active) throw new PaymeError(ERR.ORDER_NOT_PAYABLE, "order_id");

  const createTime = params.time && Number.isFinite(Number(params.time)) ? Number(params.time) : Date.now();

  const { data: created, error } = await supabase
    .from("payme_transactions")
    .insert({
      payme_id: paymeId,
      order_id: order.id,
      amount,
      state: STATE.CREATED,
      create_time: createTime,
    })
    .select("id, create_time, state")
    .single();

  if (error || !created) {
    console.error("[Payme] could not create transaction:", error);
    throw new PaymeError(ERR.CANNOT_PERFORM);
  }

  await supabase
    .from("orders")
    .update({ transaction_id: paymeId, status: "processing", updated_at: new Date().toISOString() })
    .eq("id", order.id);

  return { create_time: created.create_time, transaction: created.id, state: created.state };
}

async function performTransaction(params: PaymeParams, supabase: SupabaseClient) {
  const tx = await findTransaction(supabase, params.id);

  // Already performed → replay the same answer.
  if (tx.state === STATE.PERFORMED) {
    return { transaction: tx.id, perform_time: tx.perform_time, state: tx.state };
  }
  if (tx.state !== STATE.CREATED) throw new PaymeError(ERR.CANNOT_PERFORM);

  if (Date.now() - tx.create_time > TRANSACTION_TIMEOUT_MS) {
    await supabase.from("payme_transactions").update({
      state: STATE.CANCELLED, reason: TIMEOUT_REASON,
      cancel_time: Date.now(), updated_at: new Date().toISOString(),
    }).eq("id", tx.id);
    throw new PaymeError(ERR.CANNOT_PERFORM);
  }

  const performTime = Date.now();
  const { error } = await supabase
    .from("payme_transactions")
    .update({ state: STATE.PERFORMED, perform_time: performTime, updated_at: new Date().toISOString() })
    .eq("id", tx.id)
    .eq("state", STATE.CREATED);
  if (error) throw new PaymeError(ERR.CANNOT_PERFORM);

  await supabase
    .from("orders")
    .update({ status: "paid", paid_at: new Date(performTime).toISOString(), updated_at: new Date().toISOString() })
    .eq("id", tx.order_id);

  notifyPaymentSuccess(tx.order_id, tx.amount / 100, "payme");

  return { transaction: tx.id, perform_time: performTime, state: STATE.PERFORMED };
}

async function cancelTransaction(params: PaymeParams, supabase: SupabaseClient) {
  const tx = await findTransaction(supabase, params.id);
  const reason = Number.isFinite(Number(params.reason)) ? Number(params.reason) : null;

  // Already cancelled → replay.
  if (tx.state === STATE.CANCELLED || tx.state === STATE.CANCELLED_AFTER_PERFORM) {
    return { transaction: tx.id, cancel_time: tx.cancel_time, state: tx.state };
  }

  const { data: order } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", tx.order_id)
    .maybeSingle();

  // A delivered order cannot be reversed.
  if (order?.status === "delivered") {
    throw new PaymeError(ERR.CANNOT_CANCEL);
  }

  const cancelTime = Date.now();
  // Capture before the write: whether stock has to be returned depends on the
  // state the transaction was in *before* this cancellation.
  const wasPerformed = tx.state === STATE.PERFORMED;
  const newState = wasPerformed ? STATE.CANCELLED_AFTER_PERFORM : STATE.CANCELLED;

  const { error } = await supabase
    .from("payme_transactions")
    .update({ state: newState, reason, cancel_time: cancelTime, updated_at: new Date().toISOString() })
    .eq("id", tx.id);
  if (error) throw new PaymeError(ERR.CANNOT_PERFORM);

  // Reversing a paid transaction must put the reserved items back on the shelf.
  if (wasPerformed) {
    await restoreStock(supabase, tx.order_id);
  }

  await supabase
    .from("orders")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", tx.order_id);

  notifyPaymentFailed(tx.order_id, tx.amount / 100, "payme", `Payme reason ${reason ?? 0}`);

  return { transaction: tx.id, cancel_time: cancelTime, state: newState };
}

async function checkTransaction(params: PaymeParams, supabase: SupabaseClient) {
  const tx = await findTransaction(supabase, params.id);
  return {
    create_time: tx.create_time,
    perform_time: tx.perform_time,
    cancel_time: tx.cancel_time,
    transaction: tx.id,
    state: tx.state,
    reason: tx.reason,
  };
}

/** Payme reconciles its ledger against ours with GetStatement. */
async function getStatement(params: PaymeParams & { from?: number; to?: number }, supabase: SupabaseClient) {
  const from = Number(params.from);
  const to = Number(params.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new PaymeError(ERR.INVALID_REQUEST);
  }

  const { data } = await supabase
    .from("payme_transactions")
    .select("*")
    .gte("create_time", from)
    .lte("create_time", to);

  const transactions = (data ?? []).map((tx: PaymeTransaction) => ({
    id: tx.payme_id,
    time: tx.create_time,
    amount: tx.amount,
    account: { order_id: tx.order_id },
    create_time: tx.create_time,
    perform_time: tx.perform_time,
    cancel_time: tx.cancel_time,
    transaction: tx.id,
    state: tx.state,
    reason: tx.reason,
  }));

  return { transactions };
}
