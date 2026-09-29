import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { notifyOrderStatusChanged, notifyProductOutOfStock, notifyProductBackInStock, notifyProductPriceChanged } from "../_shared/telegram-notify.ts";
import { getBotToken, getServiceRoleKey, getSupabaseUrl } from "../_shared/env.ts";
import { getCorsHeaders as buildCors } from "../_shared/cors.ts";
import { verifyAdminSession, type AdminIdentity, isValidRole } from "../_shared/admin-auth.ts";
import { statusEmoji, statusLabel, statusMessage } from "../_shared/order-status.ts";
import { uploadImage, signPaths } from "../_shared/storage.ts";

const ALLOWED_TABLES = [
  "products", "categories", "orders", "users", "banners",
  "delivery_zones", "coupons", "coupon_usage", "returns",
  "reviews", "audit_log", "admin_accounts", "product_collections",
  "promotions", "favorites", "notifications", "product_relations",
  "referrals",
];

/** Return-request outcomes, distinct from order statuses. */
const RETURN_LABELS: Record<string, string> = {
  approved: "одобрен", rejected: "отклонён", refunded: "возврат средств выполнен",
};

const MUTATION_ACTIONS = ["insert", "update", "delete", "updateOrderStatus"];

// ─── Authorisation model ─────────────────────────────────────────────────────
//
// Previously this function only checked *that* a session existed, never what
// the session was allowed to do — role checks lived exclusively in the browser
// (AdminRoute). Any signed-in employee could therefore read the whole
// admin_accounts table (password hashes and session tokens included) and
// promote themselves to super_admin with a single request.
//
// The matrix below is derived from the can*() helpers in src/lib/auth.ts, which
// encode the intended division of duties. src/lib/auth.ts mirrors it for UI
// purposes; THIS file is the enforcement point.

type AdminRole = "super_admin" | "admin" | "manager" | "seller" | "support" | "content";

type Capability =
  | "products" | "banners" | "orders" | "customers" | "admins"
  | "audit" | "delivery" | "coupons" | "returns" | "reviews"
  | "messages" | "analytics" | "dashboard";

/** Higher rank may administer lower ranks. Used only for admin_accounts rules. */
const ROLE_RANK: Record<AdminRole, number> = {
  content: 1, seller: 1, support: 2, manager: 3, admin: 4, super_admin: 5,
};

/** read implies list/select; write implies insert/update/delete. */
const ROLE_PERMISSIONS: Record<AdminRole, { read: Capability[]; write: Capability[] }> = {
  super_admin: {
    read: ["products", "banners", "orders", "customers", "admins", "audit", "delivery", "coupons", "returns", "reviews", "messages", "analytics", "dashboard"],
    write: ["products", "banners", "orders", "customers", "admins", "audit", "delivery", "coupons", "returns", "reviews", "messages", "analytics"],
  },
  admin: {
    read: ["products", "banners", "orders", "customers", "admins", "audit", "delivery", "coupons", "returns", "reviews", "messages", "analytics", "dashboard"],
    write: ["products", "banners", "orders", "customers", "admins", "delivery", "coupons", "returns", "reviews", "messages", "analytics"],
  },
  manager: {
    read: ["products", "banners", "orders", "customers", "delivery", "coupons", "returns", "reviews", "messages", "analytics", "dashboard"],
    write: ["products", "banners", "orders", "delivery", "coupons", "returns", "reviews", "messages"],
  },
  support: {
    read: ["products", "orders", "customers", "returns", "reviews", "messages", "dashboard"],
    write: ["orders", "returns", "messages"],
  },
  seller: {
    read: ["products", "orders", "dashboard"],
    write: ["products"],
  },
  content: {
    read: ["products", "banners", "dashboard"],
    write: ["products", "banners"],
  },
};

const TABLE_CAPABILITY: Record<string, Capability> = {
  products: "products",
  categories: "products",
  product_collections: "products",
  product_relations: "products",
  promotions: "products",
  banners: "banners",
  orders: "orders",
  notifications: "orders",
  users: "customers",
  admin_accounts: "admins",
  audit_log: "audit",
  delivery_zones: "delivery",
  coupons: "coupons",
  coupon_usage: "coupons",
  returns: "returns",
  reviews: "reviews",
  favorites: "analytics",
  referrals: "analytics",
};

const ACTION_CAPABILITY: Record<string, { capability: Capability; write: boolean }> = {
  dashboardStats: { capability: "dashboard", write: false },
  pendingCounts: { capability: "dashboard", write: false },
  productAnalytics: { capability: "analytics", write: false },
  notifyProductWatchers: { capability: "products", write: true },
  getConversations: { capability: "messages", write: false },
  getOrderMessages: { capability: "messages", write: false },
  sendMessage: { capability: "messages", write: true },
  markMessagesRead: { capability: "messages", write: true },
  processReturn: { capability: "returns", write: true },
  updateOrderStatus: { capability: "orders", write: true },
  // Загрузка картинок раньше шла прямо из браузера под анон-ключом. Права те
  // же, что и на сам объект: кто может править товары — грузит фото товаров,
  // кто ведёт баннеры — картинки баннеров.
  uploadProductImage: { capability: "products", write: true },
  uploadBannerImage: { capability: "banners", write: true },
};

/**
 * admin_accounts holds password hashes and live session tokens. Never let them
 * leave this function, whatever the caller asks for in `data`.
 */
// `username` was in this list and does not exist on the table, so every
// `select` on admin_accounts failed outright with
// `column admin_accounts.username does not exist` — the admin panel's staff
// page could never load. Kept in sync with the actual columns; password_hash,
// session_token and session_expires_at are omitted on purpose.
const ADMIN_ACCOUNT_PUBLIC_COLUMNS =
  "id, email, first_name, role, is_active, created_at, updated_at, last_login_at";

/**
 * Fields a client may never write on admin_accounts. `password_hash` is in the
 * list because the browser used to compute the bcrypt hash itself and send it —
 * which made the hash equivalent to the password. Callers now send a plaintext
 * `password` and the database hashes it (see hash_admin_password()).
 */
const ADMIN_ACCOUNT_FORBIDDEN_FIELDS = ["password_hash", "session_token", "session_expires_at"];

const MIN_PASSWORD_LENGTH = 10;

/**
 * Replace a plaintext `password` field with a server-computed `password_hash`.
 * Returns an error message, or null on success.
 */
async function hashPasswordField(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
): Promise<string | null> {
  if (!("password" in payload)) return null;

  const password = payload.password;
  delete payload.password;

  // An empty password on update means "leave the current one alone".
  if (password === undefined || password === null || password === "") return null;

  if (typeof password !== "string") return "Password must be a string";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > 200) return "Password is too long";

  const { data: hash, error } = await supabase.rpc("hash_admin_password", {
    p_password: password,
  });
  if (error || typeof hash !== "string" || !hash.startsWith("$2")) {
    console.error("[AdminAPI] hash_admin_password failed:", error);
    return "Could not set password";
  }

  payload.password_hash = hash;
  return null;
}

function can(role: AdminRole, capability: Capability, write: boolean): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return write ? perms.write.includes(capability) : perms.read.includes(capability);
}

/**
 * Validate a caller-supplied select list.
 *
 * `select` used to pass the request's `data` field straight to
 * `supabase.from(table).select(...)` for every table except admin_accounts, so
 * the client decided which columns came back — including PostgREST embeds like
 * `*, orders(*)`, which walk foreign keys into tables the caller's role has no
 * read capability for. No caller in this repo sends a column list at all
 * (adminApi.ts only ever sends action/table/filters), so bare column names are
 * all that needs to be accepted.
 *
 * Returns the sanitised list, or null when the request should be rejected.
 */
function sanitizeColumns(table: string, requested: unknown): string | null {
  // admin_accounts is pinned regardless of what was asked for: password_hash
  // and session_token must never leave this function.
  if (table === "admin_accounts") return ADMIN_ACCOUNT_PUBLIC_COLUMNS;

  if (requested === undefined || requested === null || requested === "*") return "*";
  if (typeof requested !== "string") return null;

  const columns = requested.split(",").map((c) => c.trim()).filter(Boolean);
  if (columns.length === 0) return null;
  // Bare identifiers only — no parentheses (embeds), no dots, no operators.
  if (!columns.every((c) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(c))) return null;

  return columns.join(",");
}

/**
 * Ask auto-notify to message everyone watching a product's price or stock.
 *
 * auto-notify authenticates internal callers with the service_role key. This
 * used to send `SUPABASE_ANON_KEY ?? SUPABASE_SERVICE_ROLE_KEY` — and since
 * Supabase populates SUPABASE_ANON_KEY in every function's environment, the
 * anon key always won and auto-notify answered 401. The failure was swallowed
 * by an empty catch, so "price dropped" and "back in stock" alerts were never
 * delivered to a single customer.
 *
 * Fire-and-forget: the notification loop paces itself at ~30 messages/second,
 * so awaiting it here would hold the admin's request open for as long as there
 * are watchers.
 */
function triggerAutoNotify(productId: string, type: "price_drop" | "stock_available"): void {
  const supabaseUrl = getSupabaseUrl();
  const serviceKey = getServiceRoleKey();
  if (!supabaseUrl || !serviceKey) {
    console.error("[AdminAPI] cannot trigger auto-notify: SUPABASE_URL/SERVICE_ROLE_KEY missing");
    return;
  }

  const request = fetch(`${supabaseUrl}/functions/v1/auto-notify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
      "Apikey": serviceKey,
    },
    body: JSON.stringify({ product_id: productId, type }),
  })
    .then(async (resp) => {
      if (!resp.ok) {
        console.error(`[AdminAPI] auto-notify ${type} failed: ${resp.status} ${await resp.text()}`);
      }
    })
    .catch((err) => console.error(`[AdminAPI] auto-notify ${type} request failed:`, err));

  // Keep the isolate alive until the call completes, without blocking the response.
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  runtime?.waitUntil?.(request);
}

/**
 * Extra rules for the admin_accounts table, on top of the `admins` capability.
 * Prevents an account from escalating itself or tampering with peers above it.
 */
async function checkAdminAccountRules(
  supabase: ReturnType<typeof createClient>,
  actor: AdminIdentity,
  action: string,
  targetId: string | undefined,
  payload: Record<string, unknown> | undefined,
): Promise<string | null> {
  const actorRank = ROLE_RANK[actor.role];

  // Reject any attempt to write credential columns through the generic CRUD
  // path — including password_hash, which must be produced by the database from
  // a plaintext `password` rather than supplied by the caller.
  if (payload) {
    for (const field of ADMIN_ACCOUNT_FORBIDDEN_FIELDS) {
      if (field in payload) {
        return `Field "${field}" cannot be set directly; send "password" instead`;
      }
    }
  }

  // The role being granted must not outrank the actor.
  if (payload && "role" in payload) {
    const newRole = payload.role;
    if (!isValidRole(newRole)) return "Invalid role";
    if (ROLE_RANK[newRole] > actorRank) {
      return "Cannot grant a role higher than your own";
    }
  }

  if (action === "insert") return null;

  if (!targetId) return null;

  const { data: target } = await supabase
    .from("admin_accounts")
    .select("id, role, is_active")
    .eq("id", targetId)
    .maybeSingle();

  if (!target) return "Admin account not found";
  if (!isValidRole(target.role)) return "Target account has no valid role";

  const isSelf = target.id === actor.id;

  // No self-service role changes or self-deactivation/deletion.
  //
  // The test is on the *value*, not on the key. The staff form posts the whole
  // record, so `role` and `is_active` are always present — rejecting on their
  // presence alone meant an admin could never edit their own name or change
  // their own password, which is the one self-service operation that should
  // work. Comparing against the stored row keeps the rule that matters: you
  // still cannot promote yourself or switch yourself off.
  //
  // Both comparisons are strict, so anything that is not exactly the current
  // value — including a string "true" where a boolean is expected — fails
  // closed.
  if (isSelf) {
    if (action === "delete") return "You cannot delete your own account";
    if (payload && "role" in payload && payload.role !== target.role) {
      return "You cannot change your own role";
    }
    if (payload && "is_active" in payload && payload.is_active !== target.is_active) {
      return "You cannot change your own active status";
    }
    return null;
  }

  // Never touch an account that outranks you, and never touch a peer of equal
  // rank unless you are a super_admin.
  const targetRank = ROLE_RANK[target.role];
  if (targetRank > actorRank) return "Cannot modify an account with a higher role";
  if (targetRank === actorRank && actor.role !== "super_admin") {
    return "Cannot modify an account with the same role";
  }

  return null;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCors(req, { methods: "GET, POST, PUT, DELETE, OPTIONS" });
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json();
    const { action, table, data, filters, id, admin_session, period } = body;

    // Actions that don't require a table parameter
    const TABLELESS_ACTIONS = [
      "processReturn", "dashboardStats", "pendingCounts",
      // Order chat (admin side). These wrap SECURITY DEFINER functions that
      // used to be reachable with the public anon key.
      "getConversations", "getOrderMessages", "sendMessage", "markMessagesRead",
      "productAnalytics", "notifyProductWatchers",
    ];

    // An action carrying its own capability rule (dashboard, chat, order status
    // transitions…) is authorised by that rule and needs no table parameter.
    const needsTable = !TABLELESS_ACTIONS.includes(action) && !ACTION_CAPABILITY[action];
    if (!action || (!table && needsTable)) {
      return new Response(
        JSON.stringify({ error: "Missing action or table" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (table && !ALLOWED_TABLES.includes(table)) {
      return new Response(
        JSON.stringify({ error: "Table not allowed" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Authentication: every action needs a valid session, no exceptions ────
    //
    // The old code skipped auth entirely for `select` on any table outside a
    // hand-maintained SENSITIVE_TABLES list, which left favorites, referrals,
    // reviews and promotions readable through service_role by anyone holding
    // the public anon key.
    const check = await verifyAdminSession(supabase, admin_session);
    if (!check.ok || !check.admin) {
      return new Response(
        JSON.stringify({ error: check.error }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const actor = check.admin;

    // ── Authorisation: does this role may perform this action? ───────────────
    const isWrite = MUTATION_ACTIONS.includes(action);
    const actionRule = ACTION_CAPABILITY[action];
    const capability: Capability | undefined = actionRule
      ? actionRule.capability
      : table
        ? TABLE_CAPABILITY[table]
        : undefined;

    if (!capability) {
      return new Response(
        JSON.stringify({ error: `Unknown action: ${action}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const needsWrite = actionRule ? actionRule.write : isWrite;
    if (!can(actor.role, capability, needsWrite)) {
      console.warn(`[AdminAPI] ${actor.role} denied ${needsWrite ? "write" : "read"} on "${capability}" (action=${action}, table=${table ?? "-"})`);
      return new Response(
        JSON.stringify({ error: "Insufficient permissions" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Reserved ids: reject the removed mass-operation escape hatches ───────
    //
    // `__bulk__` (update) and `__filter__` (delete) used to mean "apply to every
    // row matching `filters`". Since `{}` is truthy, `filters: {}` produced a
    // statement with no WHERE clause. Both branches are gone; reject the magic
    // values explicitly so a stale client gets a clear error instead of an
    // id-cast failure, and so the intent is not silently reintroduced.
    if (typeof id === "string" && (id === "__bulk__" || id === "__filter__")) {
      return new Response(
        JSON.stringify({ error: "Bulk operations by filter are not supported; target a single id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Extra guards for the admin_accounts table ────────────────────────────
    if (table === "admin_accounts" && isWrite) {
      const ruleError = await checkAdminAccountRules(supabase, actor, action, id, data);
      if (ruleError) {
        console.warn(`[AdminAPI] admin_accounts rule blocked ${actor.role}/${actor.id}: ${ruleError}`);
        return new Response(
          JSON.stringify({ error: ruleError }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Turn the plaintext password into a hash computed by the database.
      if (data && typeof data === "object") {
        const hashError = await hashPasswordField(supabase, data as Record<string, unknown>);
        if (hashError) {
          return new Response(
            JSON.stringify({ error: hashError }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // A new account without a password could never be logged into.
      if (action === "insert" && !(data as Record<string, unknown>)?.password_hash) {
        return new Response(
          JSON.stringify({ error: "Password is required for a new account" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    let result;

    switch (action) {
      case "select": {
        const columns = sanitizeColumns(table, data);
        if (columns === null) {
          return new Response(
            JSON.stringify({ error: "Invalid column selection" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        let query = supabase.from(table).select(columns);
        if (filters) {
          for (const [key, value] of Object.entries(filters)) {
            if (value !== undefined && value !== null) {
              query = query.eq(key, value as string);
            }
          }
        }
        if (table === "orders") {
          query = query.order("created_at", { ascending: false }).range(0, 499);
        } else if (table === "audit_log") {
          query = query.order("created_at", { ascending: false }).limit(200);
        } else {
          query = query.order("created_at", { ascending: false }).range(0, 499);
        }
        const { data: rows, error } = await query;
        if (error) throw error;

        // Фото отзывов и возвратов лежат в закрытых бакетах: в базе хранится
        // путь, а показать можно только по подписанной ссылке.
        if (table === "reviews" || table === "returns") {
          const bucket = table === "reviews" ? "review-photos" : "return-photos";
          result = await Promise.all((rows ?? []).map(async (row) => {
            const r = row as Record<string, unknown>;
            const signed: Record<string, unknown> = { ...r };
            if ("photos" in r) signed.photos = await signPaths(supabase, bucket, r.photos);
            if ("images" in r) signed.images = await signPaths(supabase, bucket, r.images);
            return signed;
          }));
        } else {
          result = rows;
        }
        break;
      }

      case "insert": {
        const returning = table === "admin_accounts" ? ADMIN_ACCOUNT_PUBLIC_COLUMNS : "*";
        const { data: inserted, error } = await supabase
          .from(table)
          .insert(data)
          .select(returning)
          .single();
        if (error) throw error;
        result = inserted;
        break;
      }

      case "update": {
        // NOTE: an `id: "__bulk__"` escape hatch used to update every row
        // matching `filters`. Because `{}` is truthy, `filters: {}` produced an
        // UPDATE with no WHERE clause — one request could rewrite an entire
        // table. Its only caller (markAllNotificationsRead) is gone; customers
        // mark their own notifications through client-api. Removed rather than
        // repaired: a filter-driven mass update is not a primitive this API
        // should expose.
        {
          if (!id) throw new Error("ID required for update");

          const { error } = await supabase
            .from(table)
            .update({ ...data, updated_at: new Date().toISOString() })
            .eq("id", id);
          if (error) throw error;
          result = { success: true };

          if (table === "products" && (data.price !== undefined || data.stock !== undefined)) {
            const { data: oldProduct } = await supabase
              .from("products")
              .select("price, stock, name")
              .eq("id", id)
              .maybeSingle();

            if (oldProduct) {
              const productName = typeof oldProduct.name === "object"
                ? (oldProduct.name as { ru: string }).ru
                : String(oldProduct.name || "Товар");

              const priceDropped = data.price !== undefined && oldProduct.price !== undefined && Number(data.price) < Number(oldProduct.price);
              const priceIncreased = data.price !== undefined && oldProduct.price !== undefined && Number(data.price) > Number(oldProduct.price);
              const stockAvailable = data.stock !== undefined && oldProduct.stock !== undefined && Number(oldProduct.stock) <= 0 && Number(data.stock) > 0;
              const stockOut = data.stock !== undefined && oldProduct.stock !== undefined && Number(oldProduct.stock) > 0 && Number(data.stock) <= 0;

              if (priceDropped) {
                notifyProductPriceChanged(id, productName, Number(oldProduct.price), Number(data.price));
                triggerAutoNotify(id, "price_drop");
              } else if (priceIncreased) {
                notifyProductPriceChanged(id, productName, Number(oldProduct.price), Number(data.price));
              }

              if (stockOut) {
                notifyProductOutOfStock(id, productName);
              } else if (stockAvailable) {
                notifyProductBackInStock(id, productName);
                triggerAutoNotify(id, "stock_available");
              }
            }
          }
        }
        break;
      }

      case "delete": {
        // The matching `id: "__filter__"` branch for deletes had the same flaw:
        // `filters: {}` meant DELETE with no WHERE. Its only caller
        // (adminQueries.removeFavorite) was itself broken — it passed the
        // filters in `data`, which this branch never read — and unused.
        if (!id) throw new Error("ID required for delete");
        const { error } = await supabase.from(table).delete().eq("id", id);
        if (error) throw error;
        result = { success: true };
        break;
      }

      case "updateOrderStatus": {
        if (!id) throw new Error("ID required");
        const { status, changed_by, note } = data || {};

        // Fetch order first to get telegram_user_id for notifications
        const { data: orderRow } = await supabase
          .from("orders")
          .select("telegram_user_id")
          .eq("id", id)
          .maybeSingle();

        const telegramUserId = orderRow?.telegram_user_id;

        // Use RPC function which handles auto-archiving and stock return
        const { data: updatedOrder, error: rpcErr } = await supabase.rpc("append_order_status", {
          p_order_id: id as unknown as never,
          p_status: status,
          p_changed_by: changed_by || "Admin",
          p_note: note || null,
        }).maybeSingle();

        if (rpcErr) throw rpcErr;

        if (telegramUserId) {

          const shortOrderId = id.slice(0, 8).toUpperCase();

          // NOTE: the Supabase query builder is a thenable, not a Promise — it
          // has no .catch(). The former `.catch(() => {})` here threw a
          // TypeError that the outer try/catch turned into a 500, so every
          // successful status change was reported to the admin as a failure.
          const { error: notifyErr } = await supabase.from("notifications").insert({
            telegram_user_id: telegramUserId,
            type: `order_${status}`,
            title: `📦 Заказ #${shortOrderId}`,
            body: statusMessage(status),
            data: { order_id: id, status },
          });
          if (notifyErr) {
            console.error(`[AdminAPI] could not store notification for order ${shortOrderId}:`, notifyErr);
          }

          const botToken = getBotToken();
          if (botToken) {
            const emoji = statusEmoji(status);
            const text = `${emoji} <b>${statusMessage(status)}</b>\n\n` +
              `Заказ #${shortOrderId}\n` +
              `Статус: <b>${statusLabel(status)}</b>`;

            try {
              const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: String(telegramUserId),
                  text: text,
                  parse_mode: "HTML",
                }),
              });
              if (!resp.ok) {
                const errBody = await resp.text();
                console.error(`Telegram send failed for order ${shortOrderId}: ${resp.status} ${errBody}`);
              }
            } catch (e) {
              console.error(`Telegram send error for order ${shortOrderId}:`, e);
            }
          } else {
            console.warn("No TELEGRAM_BOT_TOKEN or BOT_TOKEN configured — skipping order notification");
          }
        }

        // Notify admin about status change
        notifyOrderStatusChanged(id, status, changed_by || "Admin");

        result = updatedOrder;
        break;
      }

      case "uploadProductImage":
      case "uploadBannerImage": {
        const bucket = action === "uploadProductImage" ? "product-images" : "banner-images";
        const payload = (data ?? {}) as { content_base64?: string; content_type?: string };
        const upload = await uploadImage(supabase, {
          bucket,
          content_base64: payload.content_base64 ?? "",
          content_type: payload.content_type ?? "",
          prefix: action === "uploadBannerImage" ? "banners" : "",
        }, [bucket]);
        if (!upload.ok) {
          return new Response(
            JSON.stringify({ error: upload.error }),
            { status: upload.status ?? 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        console.log(`[AdminAPI] ${actor.role} загрузил файл в ${bucket}`);
        result = { path: upload.path, url: upload.url };
        break;
      }

      case "processReturn": {
        const { return_id, status, admin_note } = data || {};
        if (!return_id || !status) throw new Error("return_id and status required");

        const { data: updated, error: rpcErr } = await supabase.rpc("process_return_stock", {
          p_return_id: return_id,
          p_status: status,
          p_admin_note: admin_note || null,
        }).maybeSingle();

        if (rpcErr) throw rpcErr;
        result = updated;

        const { data: ret } = await supabase
          .from("returns")
          .select("telegram_user_id, order_id")
          .eq("id", return_id)
          .maybeSingle();

        if (ret?.order_id && status === "refunded") {
          const { data: currentOrder } = await supabase
            .from("orders")
            .select("status")
            .eq("id", ret.order_id)
            .maybeSingle();

          if (currentOrder && currentOrder.status !== "returned") {
            const { error: statusErr } = await supabase.rpc("append_order_status", {
              p_order_id: ret.order_id,
              p_status: "returned",
              p_changed_by: "System",
              p_note: "Возврат завершён",
            });
            if (statusErr) {
              console.error(`[AdminAPI] could not mark order ${ret.order_id} as returned:`, statusErr);
            }
          }
        }

        if (ret?.telegram_user_id) {
          const shortOrderId = ret.order_id?.slice(0, 8).toUpperCase() || "";

          const { error: returnNotifyErr } = await supabase.from("notifications").insert({
            telegram_user_id: ret.telegram_user_id,
            type: `return_${status}`,
            title: `🔄 Возврат #${shortOrderId}`,
            body: status === "refunded"
              ? "Возврат завершён. Информация о заказе скрыта из ваших заказов."
              : `Ваша заявка на возврат ${RETURN_LABELS[status] ?? status}`,
            data: { order_id: ret.order_id, return_id, status },
          });
          if (returnNotifyErr) {
            console.error(`[AdminAPI] could not store return notification for ${return_id}:`, returnNotifyErr);
          }

          const botToken = getBotToken();
          if (botToken) {
            const emoji = status === "approved" ? "✅" : status === "rejected" ? "❌" : "💰";
            const telegramText = status === "refunded"
              ? `${emoji} <b>Возврат #${shortOrderId}</b>\n\nВозврат завершён. Заказ скрыт из списка заказов.`
              : `${emoji} <b>Возврат #${shortOrderId}</b>\n\nВаша заявка ${RETURN_LABELS[status] ?? status}`;
            try {
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: String(ret.telegram_user_id),
                  text: telegramText,
                  parse_mode: "HTML",
                }),
              });
            } catch { /* non-critical */ }
          }
        }
        break;
      }

      // ── Order chat, admin side (admin session already verified above) ──────
      case "getConversations": {
        const { data: rows, error } = await supabase.rpc("get_admin_conversations");
        if (error) throw error;
        result = rows ?? [];
        break;
      }

      case "getOrderMessages": {
        const { order_id } = data || {};
        if (!order_id) throw new Error("order_id required");
        const { data: rows, error } = await supabase.rpc("get_order_messages", {
          p_order_id: order_id,
        });
        if (error) throw error;
        result = rows ?? [];
        break;
      }

      case "sendMessage": {
        const { order_id, content } = data || {};
        if (!order_id) throw new Error("order_id required");
        const text = typeof content === "string" ? content.trim() : "";
        if (!text || text.length > 2000) throw new Error("Message must be 1-2000 characters");

        const { data: order } = await supabase
          .from("orders")
          .select("telegram_user_id")
          .eq("id", order_id)
          .maybeSingle();
        if (!order) throw new Error("Order not found");

        const { data: sent, error } = await supabase.rpc("send_message", {
          p_order_id: order_id,
          p_sender_type: "admin",
          p_sender_id: "admin",
          p_receiver_id: String(order.telegram_user_id),
          p_content: text,
        }).single();
        if (error) throw error;
        result = sent;
        break;
      }

      case "markMessagesRead": {
        const { order_id } = data || {};
        if (!order_id) throw new Error("order_id required");
        const { error } = await supabase.rpc("mark_messages_read", {
          p_order_id: order_id,
          p_sender_id: "admin",
        });
        if (error) throw error;
        result = { success: true };
        break;
      }

      // Manually notify everyone watching a product's price or stock.
      //
      // send-message used to carry a near-copy of auto-notify's loop for this,
      // and the copy was the weaker one: it sent the Telegram message but never
      // created the in-app notification, so the bell icon stayed empty. Both
      // paths now go through auto-notify.
      case "notifyProductWatchers": {
        const { product_id, type } = data || {};
        if (!product_id) throw new Error("product_id required");
        if (type !== "price_drop" && type !== "stock_available") {
          throw new Error("type must be 'price_drop' or 'stock_available'");
        }
        triggerAutoNotify(product_id, type);
        result = { success: true, queued: true };
        break;
      }

      case "productAnalytics": {
        const { data: rows, error } = await supabase.rpc("get_all_product_analytics");
        if (error) throw error;
        result = rows ?? [];
        break;
      }

      case "pendingCounts": {
        const [ordersRes, reviewsRes, returnsRes] = await Promise.all([
          supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "new"),
          supabase.from("reviews").select("id", { count: "exact", head: true }).eq("is_approved", false),
          supabase.from("returns").select("id", { count: "exact", head: true }).eq("status", "pending"),
        ]);
        result = {
          orders: ordersRes.count ?? 0,
          reviews: reviewsRes.count ?? 0,
          returns: returnsRes.count ?? 0,
        };
        break;
      }

      case "dashboardStats": {
        const now = new Date();
        let dateFrom: string | null = null;

        if (period === "7d") {
          const d = new Date(now);
          d.setDate(d.getDate() - 6);
          dateFrom = d.toISOString().slice(0, 10);
        } else if (period === "30d") {
          const d = new Date(now);
          d.setDate(d.getDate() - 29);
          dateFrom = d.toISOString().slice(0, 10);
        }

        let ordersQuery = supabase
          .from("orders")
          .select("total_amount, status, created_at, items", { count: "exact" });
        if (dateFrom) {
          ordersQuery = ordersQuery.gte("created_at", dateFrom + "T00:00:00");
        }

        const [ordersRes, productsRes, recentRes, bannersRes, usersRes, pendingOrdersRes, pendingReviewsRes, pendingReturnsRes] = await Promise.all([
          ordersQuery,
          supabase.from("products").select("id", { count: "exact" }),
          supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(6),
          supabase.from("banners").select("id", { count: "exact" }).eq("is_active", true),
          supabase.from("users").select("id", { count: "exact" }),
          supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "new"),
          supabase.from("reviews").select("id", { count: "exact", head: true }).eq("is_approved", false),
          supabase.from("returns").select("id", { count: "exact", head: true }).eq("status", "pending"),
        ]);

        const allOrders = ordersRes.data ?? [];
        const totalRevenue = allOrders.reduce((s, o) => s + Number(o.total_amount), 0);
        const avgOrderValue = allOrders.length ? totalRevenue / allOrders.length : 0;

        const days = period === "7d" ? 7 : period === "30d" ? 30 : 14;
        const salesByDay = Array.from({ length: days }, (_, i) => {
          const d = new Date(now);
          d.setDate(d.getDate() - (days - 1 - i));
          const dateStr = d.toISOString().slice(0, 10);
          const dayOrders = allOrders.filter(o => o.created_at?.slice(0, 10) === dateStr);
          return {
            date: dateStr,
            revenue: dayOrders.reduce((s, o) => s + Number(o.total_amount), 0),
            orders: dayOrders.length,
          };
        });

        const ordersByStatus: Record<string, number> = {};
        allOrders.forEach(o => {
          ordersByStatus[o.status] = (ordersByStatus[o.status] ?? 0) + 1;
        });

        const productMap: Record<string, { name: string; orders: number; revenue: number }> = {};
        allOrders.forEach(order => {
          const items = order.items;
          if (!Array.isArray(items)) return;
          items.forEach((item: Record<string, unknown>) => {
            const key = (item.productId as string) ?? "unknown";
            const rawName = item.name;
            const itemName = typeof rawName === "object" && rawName !== null
              ? ((rawName as Record<string, string>).ru ?? key)
              : String(rawName ?? key);
            if (!productMap[key]) {
              productMap[key] = { name: itemName, orders: 0, revenue: 0 };
            }
            productMap[key].orders += (item.quantity as number) ?? 1;
            productMap[key].revenue += ((item.price as number) ?? 0) * ((item.quantity as number) ?? 1);
          });
        });
        const topProducts = Object.values(productMap)
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 5);

        result = {
          totalOrders: ordersRes.count ?? 0,
          totalRevenue,
          totalProducts: productsRes.count ?? 0,
          totalUsers: usersRes.count ?? 0,
          recentOrders: recentRes.data ?? [],
          salesByDay,
          topProducts,
          ordersByStatus,
          avgOrderValue,
          activeBanners: bannersRes.count ?? 0,
          newUsersCount: usersRes.count ?? 0,
          pendingOrders: pendingOrdersRes.count ?? 0,
          pendingReviews: pendingReviewsRes.count ?? 0,
          pendingReturns: pendingReturnsRes.count ?? 0,
        };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Admin API error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
