import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hashToken, verifyAdminSession } from "../_shared/admin-auth.ts";

/**
 * Brute-force throttling.
 *
 * IMPORTANT — like every limiter in these functions this lives in one isolate's
 * memory: it resets on a cold start and is not shared across concurrently
 * running isolates. It raises the cost of guessing a password; it does not make
 * guessing impossible. A limiter that actually holds needs shared state.
 *
 * Two independent buckets, because they stop different attacks:
 *
 *   - per email — one account being guessed at.
 *   - per IP — one attacker spraying one password across many accounts, which
 *     the email bucket never sees because each address gets its own counter.
 *     Only the email bucket existed before, so account spraying was unthrottled.
 *
 * The IP allowance is deliberately looser: a shop's staff can share one office
 * NAT, and locking all of them out over one person's typo would be its own
 * outage.
 */
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS_PER_EMAIL = 5;
const MAX_ATTEMPTS_PER_IP = 20;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function limitFor(key: string): number {
  return key.startsWith("ip:") ? MAX_ATTEMPTS_PER_IP : MAX_ATTEMPTS_PER_EMAIL;
}

function checkRateLimit(keys: string[]): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();

  // Opportunistic sweep — without it the map grows for the isolate's lifetime.
  if (loginAttempts.size > 500) {
    for (const [key, val] of loginAttempts) {
      if (now > val.resetAt) loginAttempts.delete(key);
    }
  }

  for (const key of keys) {
    const entry = loginAttempts.get(key);
    if (entry && now < entry.resetAt && entry.count >= limitFor(key)) {
      return { allowed: false, retryAfterMs: entry.resetAt - now };
    }
  }
  return { allowed: true };
}

function recordAttempt(keys: string[]) {
  const now = Date.now();
  for (const key of keys) {
    const entry = loginAttempts.get(key);
    if (entry && now < entry.resetAt) {
      entry.count++;
      if (entry.count >= limitFor(key)) {
        entry.resetAt = now + LOCKOUT_MS;
      }
    } else {
      loginAttempts.set(key, { count: 1, resetAt: now + LOCKOUT_MS });
    }
  }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  // Какой Origin пришёл и что мы на него ответили. Без этого нельзя отличить
  // «неверный пароль» от «браузер отменил запрос, потому что страница открыта
  // по адресу, которого нет в ALLOWED_ORIGINS»: в обоих случаях в логах видно
  // только OPTIONS, а пользователю показывают одну и ту же ошибку.
  console.log(
    `[admin-login] ${req.method} origin=${req.headers.get("Origin") ?? "(нет)"} ` +
    `allow=${corsHeaders["Access-Control-Allow-Origin"]}`
  );
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { email, password, verify_session, admin_id, token } = await req.json();

    // ── Session verification mode ────────────────────────────────────────────
    //
    // This used to re-implement the whole check inline: SHA-256 spelled out by
    // hand three lines below an already-imported `hashToken`, and its own copy
    // of the account lookup that — unlike the shared one — never looked at the
    // account's role. Two implementations of "is this session valid", and only
    // one of them complete. `verifyAdminSession` is the same function admin-api
    // and client-api gate every request with.
    if (verify_session && admin_id && token) {
      const check = await verifyAdminSession(supabase, { admin_id, token });
      return new Response(
        JSON.stringify(check.ok ? { valid: true } : { valid: false, error: check.error }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: "Email and password are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate limit check — the account being guessed at, and the source spraying.
    const clientIp = (req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown")
      .split(",")[0]
      .trim() || "unknown";
    const rateLimitKeys = [
      `login:${email.trim().toLowerCase()}`,
      `ip:${clientIp}`,
    ];

    const rateCheck = checkRateLimit(rateLimitKeys);
    if (!rateCheck.allowed) {
      const retryAfterMs = rateCheck.retryAfterMs ?? 0;
      const minutes = Math.ceil(retryAfterMs / 60000);
      return new Response(
        JSON.stringify({ error: `Too many login attempts. Try again in ${minutes} minutes.` }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
          },
        }
      );
    }

    // Use the SQL function to verify password (handles bcrypt + plain text)
    const { data: result, error } = await supabase.rpc("verify_admin_password", {
      p_email: email.trim().toLowerCase(),
      p_password: password,
    }).maybeSingle();

    if (error || !result?.valid) {
      recordAttempt(rateLimitKeys);
      return new Response(
        JSON.stringify({ error: result?.error || "Invalid credentials" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // A correct password clears this account's counter. The IP bucket is left
    // alone on purpose: one success must not wipe the record of failures
    // against other accounts from the same source, which is exactly the
    // spraying pattern the IP bucket exists to catch.
    loginAttempts.delete(rateLimitKeys[0]);

    // Generate session token
    const sessionToken = crypto.randomUUID();
    const tokenHash = await hashToken(sessionToken);

    // Update session in DB
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("admin_accounts")
      .update({
        last_login_at: new Date().toISOString(),
        session_token: tokenHash,
        session_expires_at: expiresAt,
      })
      .eq("id", result.id);

    // Log the login
    await supabase.from("audit_log").insert({
      admin_id: result.id,
      action: "login",
      entity_type: "admin_accounts",
      entity_id: result.id,
      details: { email: result.email },
    });

    return new Response(
      JSON.stringify({
        success: true,
        admin: {
          id: result.id,
          email: result.email,
          first_name: result.first_name,
          role: result.role,
        },
        sessionToken,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Admin login error:", error);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

