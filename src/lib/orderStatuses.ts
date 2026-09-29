/**
 * Order statuses, with the Tailwind classes each badge renders in.
 *
 * These classes are strings in a data table rather than `className` attributes,
 * which is why nothing caught them going stale: the compiler does not look
 * inside strings, and tests/find-dead-classes.mjs only scans `className=`.
 *
 * What was here before referenced `bg-brand-600` / `bg-brand-700` — there is no
 * `brand` palette in tailwind.config.js at all, so those produced no CSS and
 * left `text-white` on a transparent background. "В доставке", "Доставлен" and
 * "Оплачен" rendered as white text on a white card in Orders, Profile,
 * AdminOrders and AdminDashboard. The `surface-300/500/600` steps used for the
 * text and dots do not exist either (the scale defines 50/100/200/400/700+).
 *
 * Every class below is drawn from the palette in tailwind.config.js. Colour
 * carries the stage: neutral = not started, info = being prepared,
 * warning = in transit, success = money or goods landed, danger = failed.
 *
 * The hue lives in the background tint and in `dot`, and the label stays
 * neutral. Tinting the *text* with `text-success` / `text-warning` was the
 * obvious first move, but measured against the tint it lands at 2.9:1 in the
 * light theme — the badge is 12px bold, which WCAG counts as small text and
 * wants 4.5:1. The mid-tone `--success` / `--warning` values in index.css are
 * simply too light to sit on a near-white background, and the same tokens are
 * broken in the dark theme too (`--success-bg` is a copy of `--success`), so
 * fixing this in the palette is a separate change. Neutral labels measure
 * 9.9–15.7:1 across both themes and need no palette work.
 */
export const ORDER_STATUSES = [
  { value: 'new',              label_ru: 'Новый',         label_uz: 'Yangi',              color: 'bg-surface-muted text-text-secondary',      dot: 'bg-text-tertiary' },
  { value: 'processing',       label_ru: 'В обработке',   label_uz: "Ko'rib chiqilmoqda", color: 'bg-info/10 dark:bg-info/20 text-text',      dot: 'bg-info' },
  { value: 'assembling',       label_ru: 'В сборке',      label_uz: "Yig'ilmoqda",        color: 'bg-info/10 dark:bg-info/20 text-text',      dot: 'bg-info' },
  { value: 'assembled',        label_ru: 'Собран',        label_uz: "Yig'ildi",           color: 'bg-info/10 dark:bg-info/20 text-text',      dot: 'bg-info' },
  { value: 'shipping',         label_ru: 'В доставке',    label_uz: 'Yetkazilmoqda',      color: 'bg-warning/10 dark:bg-warning/20 text-text', dot: 'bg-warning' },
  { value: 'shipped',          label_ru: 'Отправлен',     label_uz: 'Yuborilgan',         color: 'bg-warning/10 dark:bg-warning/20 text-text', dot: 'bg-warning' },
  { value: 'delivered',        label_ru: 'Доставлен',     label_uz: 'Yetkazildi',         color: 'bg-success/10 dark:bg-success/20 text-text', dot: 'bg-success' },
  { value: 'paid',             label_ru: 'Оплачен',       label_uz: "To'langan",          color: 'bg-success/10 dark:bg-success/20 text-text', dot: 'bg-success' },
  { value: 'cancelled',        label_ru: 'Отменён',       label_uz: 'Bekor qilindi',      color: 'bg-danger/10 dark:bg-danger/20 text-text',  dot: 'bg-danger' },
  { value: 'return_requested', label_ru: 'Возврат',       label_uz: 'Qaytarish',          color: 'bg-danger/10 dark:bg-danger/20 text-text',  dot: 'bg-danger' },
  { value: 'returned',         label_ru: 'Возвращён',     label_uz: 'Qaytarildi',         color: 'bg-surface-muted text-text-secondary',      dot: 'bg-text-tertiary' },
] as const;

export type OrderStatusValue = typeof ORDER_STATUSES[number]['value'];

export const getStatusInfo = (value: string) =>
  ORDER_STATUSES.find((s) => s.value === value) ?? ORDER_STATUSES[0];

export const getStatusLabel = (status: string, lang: 'ru' | 'uz') => {
  const info = getStatusInfo(status);
  return lang === 'ru' ? info.label_ru : info.label_uz;
};

export const getStatusColor = (status: string) => getStatusInfo(status).color;
