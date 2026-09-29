/**
 * Order status vocabulary, shared by admin-api and telegram-notify.
 *
 * The labels were declared three times — twice inside admin-api alone — and had
 * already drifted: "shipping" read "В пути" in one copy and "В доставке" in
 * another, so the same transition described itself differently depending on
 * which notification the customer happened to receive.
 */

export const ORDER_STATUSES = [
  "new", "processing", "assembling", "assembled", "shipping", "shipped",
  "delivered", "cancelled", "return_requested", "returned", "paid",
] as const;

export type OrderStatus = typeof ORDER_STATUSES[number];

/** Short name of the status, for lists and badges. */
export const STATUS_LABELS: Record<string, string> = {
  new: "Новый",
  processing: "В обработке",
  assembling: "В сборке",
  assembled: "Собран",
  shipping: "В пути",
  shipped: "Отправлен",
  delivered: "Доставлен",
  cancelled: "Отменён",
  return_requested: "Запрос возврата",
  returned: "Возвращён",
  paid: "Оплачен",
};

/** Customer-facing sentence announcing the transition. */
export const STATUS_MESSAGES: Record<string, string> = {
  new: "Ваш заказ принят!",
  processing: "Заказ обрабатывается",
  assembling: "Заказ собирается",
  assembled: "Заказ собран",
  shipping: "Заказ в пути к вам",
  shipped: "Заказ отправлен",
  delivered: "Заказ доставлен! Спасибо за покупку!",
  cancelled: "Заказ отменён",
  return_requested: "Запрос на возврат получен",
  returned: "Возврат оформлен",
  paid: "Оплата получена",
};

export const STATUS_EMOJI: Record<string, string> = {
  new: "🆕",
  processing: "⚙️",
  assembling: "📦",
  assembled: "✅",
  shipping: "🚚",
  shipped: "🚚",
  delivered: "✅",
  cancelled: "❌",
  return_requested: "🔄",
  returned: "↩️",
  paid: "💳",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function statusMessage(status: string): string {
  return STATUS_MESSAGES[status] ?? `Статус: ${statusLabel(status)}`;
}

export function statusEmoji(status: string): string {
  return STATUS_EMOJI[status] ?? "📦";
}
