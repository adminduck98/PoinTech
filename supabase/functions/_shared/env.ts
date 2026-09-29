/**
 * Environment access for Edge Functions.
 *
 * The bot token had accumulated three different spellings across the
 * functions — `TELEGRAM_BOT_TOKEN`, `BOT_TOKEN`, and a fallback chain between
 * them — so which functions worked depended on which name the operator had
 * happened to set. process-broadcast, for example, read only `BOT_TOKEN` and
 * reported "BOT_TOKEN not configured" on a project configured with
 * `TELEGRAM_BOT_TOKEN`. Read it here, in one place, and accept both names.
 */

/** Telegram bot token. Returns "" when unset — callers must fail closed. */
export function getBotToken(): string {
  return Deno.env.get("TELEGRAM_BOT_TOKEN") ?? Deno.env.get("BOT_TOKEN") ?? "";
}

/** Chat id that receives operational notifications. */
export function getAdminTelegramId(): string {
  return Deno.env.get("ADMIN_TELEGRAM_ID") ?? "";
}

/** service_role key — full database access, never send it to a browser. */
export function getServiceRoleKey(): string {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

export function getSupabaseUrl(): string {
  return Deno.env.get("SUPABASE_URL") ?? "";
}

/**
 * Constant-time string comparison, for secrets carried in headers.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Authorise an internal function-to-function call, which must carry
 * `Authorization: Bearer <service_role key>`.
 *
 * Some functions used `authHeader.includes(serviceKey)`, which also matches a
 * header that merely *contains* the key anywhere in it; this requires the exact
 * Bearer form and compares in constant time.
 */
export function isInternalServiceCall(req: Request): boolean {
  const serviceKey = getServiceRoleKey();
  if (!serviceKey) return false;
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  return timingSafeEqual(header.slice("Bearer ".length), serviceKey);
}
