/**
 * Telegram Mini App initData verification.
 *
 * Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 *   1. Parse initData as a query string.
 *   2. Build data_check_string: all pairs except `hash` (and `signature`, which
 *      Telegram adds for third-party Ed25519 validation), sorted alphabetically,
 *      joined by "\n".
 *   3. secret_key = HMAC_SHA256(key: "WebAppData", message: bot_token)
 *   4. expected   = HMAC_SHA256(key: secret_key,  message: data_check_string)
 *   5. Compare `expected` with the `hash` field in constant time.
 *   6. Reject if auth_date is older than maxAgeSeconds.
 *
 * Step 3 is the part that is easy to get wrong: the bot token is the *message*
 * of the first HMAC, not the key of the second one. Signing data_check_string
 * directly with the bot token is the Telegram Login Widget scheme and never
 * matches Mini App initData.
 */

export { getBotToken } from "./env.ts";
import { timingSafeEqual } from "./env.ts";

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface VerifyResult {
  valid: boolean;
  user?: TelegramUser;
  error?: string;
}

/** initData older than this is rejected. */
export const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

/** Tolerance for clock skew between Telegram and the edge runtime. */
const FUTURE_SKEW_TOLERANCE_SECONDS = 300;


async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(message),
  );
  return new Uint8Array(signature);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function buildDataCheckString(
  params: URLSearchParams,
  includeSignature: boolean,
): string {
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    if (key === "signature" && !includeSignature) continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  return pairs.join("\n");
}

/**
 * Verify Telegram Mini App initData and extract the authenticated user.
 *
 * Returns `valid: false` for every failure mode — callers must treat anything
 * other than `valid: true` as an unauthenticated request.
 */
export async function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number = DEFAULT_MAX_AGE_SECONDS,
): Promise<VerifyResult> {
  if (!initData) return { valid: false, error: "Missing initData" };
  if (!botToken) return { valid: false, error: "Bot token is not configured" };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { valid: false, error: "Malformed initData" };
  }

  const hash = params.get("hash");
  const authDate = params.get("auth_date");
  if (!hash || !authDate) {
    return { valid: false, error: "Missing hash or auth_date" };
  }

  const authTimestamp = Number.parseInt(authDate, 10);
  if (!Number.isFinite(authTimestamp)) {
    return { valid: false, error: "Invalid auth_date" };
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - authTimestamp;
  if (ageSeconds > maxAgeSeconds) {
    return { valid: false, error: "initData expired" };
  }
  if (ageSeconds < -FUTURE_SKEW_TOLERANCE_SECONDS) {
    return { valid: false, error: "auth_date is in the future" };
  }

  const secretKey = await hmacSha256(
    new TextEncoder().encode("WebAppData"),
    botToken,
  );

  // Telegram's own reference implementations exclude `signature` from the
  // data-check-string. Older clients do not send it at all, in which case the
  // second attempt is identical to the first and is skipped.
  let matched = false;
  const attempts = params.has("signature") ? [false, true] : [false];
  for (const includeSignature of attempts) {
    const dataCheckString = buildDataCheckString(params, includeSignature);
    const expected = toHex(await hmacSha256(secretKey, dataCheckString));
    if (timingSafeEqual(expected, hash)) {
      matched = true;
      break;
    }
  }

  if (!matched) {
    return { valid: false, error: "Invalid hash" };
  }

  const userStr = params.get("user");
  if (!userStr) {
    return { valid: false, error: "initData contains no user" };
  }

  let user: TelegramUser;
  try {
    user = JSON.parse(userStr) as TelegramUser;
  } catch {
    return { valid: false, error: "Malformed user payload" };
  }

  if (
    !user ||
    typeof user.id !== "number" ||
    !Number.isFinite(user.id) ||
    !Number.isInteger(user.id) ||
    user.id <= 0
  ) {
    return { valid: false, error: "Invalid user id in initData" };
  }

  return { valid: true, user };
}
