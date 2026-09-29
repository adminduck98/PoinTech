/**
 * Admin session verification, shared by admin-api, client-api and send-message.
 *
 * Three near-identical copies existed, each with a slightly different return
 * shape (`boolean` in one, `{ ok, error }` in another) and only one of them
 * reading the account's role. That divergence is what let admin-api enforce
 * nothing but "a session exists" for so long.
 */

/**
 * The slice of the Supabase client this module uses. Typed structurally so the
 * module does not have to import supabase-js — and so a typo in the query chain
 * is still a compile error.
 */
interface AdminAccountQuery {
  select(columns: string): AdminAccountQuery;
  eq(column: string, value: unknown): AdminAccountQuery;
  maybeSingle(): Promise<{
    data: { id: string; role: string; is_active: boolean; session_expires_at: string | null } | null;
  }>;
}

interface SupabaseLike {
  from(table: "admin_accounts"): AdminAccountQuery;
  from(table: string): AdminAccountQuery;
}

export type AdminRole =
  | "super_admin" | "admin" | "manager" | "seller" | "support" | "content";

export const ALL_ROLES: AdminRole[] = [
  "super_admin", "admin", "manager", "seller", "support", "content",
];

export interface AdminIdentity {
  id: string;
  role: AdminRole;
}

export interface AdminSession {
  admin_id: string;
  token: string;
}

export interface VerifyAdminResult {
  ok: boolean;
  error?: string;
  admin?: AdminIdentity;
}

export function isValidRole(role: unknown): role is AdminRole {
  return typeof role === "string" && (ALL_ROLES as string[]).includes(role);
}

/**
 * SHA-256 hex digest. Session tokens are stored hashed, so a leaked database
 * dump cannot be replayed as a live session.
 */
export async function hashToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify an admin session and return the acting account, including its role.
 *
 * Callers must treat anything other than `ok: true` as unauthenticated.
 */
export async function verifyAdminSession(
  supabase: SupabaseLike,
  session: AdminSession | undefined,
): Promise<VerifyAdminResult> {
  if (!session?.admin_id || !session?.token) {
    return { ok: false, error: "Admin session required" };
  }

  const tokenHash = await hashToken(session.token);
  const { data } = await supabase
    .from("admin_accounts")
    .select("id, role, is_active, session_expires_at")
    .eq("id", session.admin_id)
    .eq("session_token", tokenHash)
    .eq("is_active", true)
    .maybeSingle();

  if (!data) return { ok: false, error: "Invalid or expired admin session" };

  if (data.session_expires_at && new Date(data.session_expires_at) < new Date()) {
    return { ok: false, error: "Session expired" };
  }

  if (!isValidRole(data.role)) {
    return { ok: false, error: "Account has no valid role" };
  }

  return { ok: true, admin: { id: data.id as string, role: data.role } };
}
