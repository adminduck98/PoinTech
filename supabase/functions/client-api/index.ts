import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getBotToken, verifyTelegramInitData } from "../_shared/telegram-verify.ts";
import { validateCoupon } from "../_shared/coupons.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyAdminSession } from "../_shared/admin-auth.ts";
import { notifyAdmin } from "../_shared/telegram-notify.ts";
import { uploadImage, signPaths } from "../_shared/storage.ts";

/**
 * Per-IP request budget.
 *
 * IMPORTANT — this counter lives in the memory of one isolate. It resets on a
 * cold start and is not shared between concurrently running isolates, so it
 * throttles a single chatty client but is NOT a defence against a distributed
 * attacker. Treat it as a courtesy limit; a real one needs shared state
 * (a Postgres counter or Redis).
 *
 * The budget used to be 30/minute, which legitimate use blew straight through:
 * WishlistToggle issued one wishlist read per product card (20 on the first
 * catalogue screen) and the order chat polled every 1.5 s (40/minute on its
 * own). Both are fixed on the client, but the ceiling was also simply too low
 * for a session that browses, opens a chat and checks out — and because the
 * limit is per IP, tripping it broke every feature at once, not just the noisy
 * one. 60/minute leaves headroom for real use while still capping a runaway
 * client.
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;

interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets — sent as Retry-After on a 429. */
  retryAfterSeconds: number;
}

function checkRateLimit(ip: string): RateLimitResult {
  const now = Date.now();
  if (rateLimitMap.size > 100) {
    for (const [key, val] of rateLimitMap) {
      if (now > val.resetAt) rateLimitMap.delete(key);
    }
  }
  const entry = rateLimitMap.get(ip);
  if (entry && now < entry.resetAt) {
    if (entry.count >= RATE_LIMIT) {
      return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
    }
    entry.count++;
    return { allowed: true, retryAfterSeconds: 0 };
  }
  rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
  return { allowed: true, retryAfterSeconds: 0 };
}

const ADMIN_ACTIONS = ["insert_notification"];

/**
 * Actions that act on behalf of a specific Telegram user. Every one of these
 * requires verified initData, and the acting user id is taken from that
 * verification — never from the request body.
 */
const USER_SCOPED_ACTIONS = [
  // writes
  "upsert_user",
  "add_favorite", "remove_favorite", "update_favorite",
  "insert_review", "mark_notification_read", "mark_all_notifications_read",
  "clear_read_notifications",
  "insert_return", "record_coupon_usage",
  // Фото к отзыву и к заявке на возврат. Раньше браузер клал их в хранилище
  // сам, под анон-ключом, то есть залить файл мог кто угодно. Теперь загрузка
  // идёт отсюда, и подпись Telegram проверяется до записи.
  "upload_review_photo", "upload_return_photo",
  // Отзывы отдаёт функция, а не PostgREST напрямую: фото лежат в закрытом
  // бакете, и ссылку на каждое надо подписать.
  "get_product_reviews",
  // reads — these used to be callable by anon with an arbitrary victim id
  "get_client_orders", "get_client_favorites",
  // reads of RLS-protected tables. The browser queried these directly, where
  // RLS denies anon and silently returned empty results, so notifications,
  // returns and the profile prefill were permanently blank.
  "get_user_profile", "get_notifications", "get_unread_notification_count",
  "get_user_returns", "validate_coupon",
  // order chat
  "get_order_messages", "send_message", "mark_messages_read",
  "get_unread_message_count",
];

/**
 * Order-chat actions must additionally prove the order belongs to the caller —
 * the underlying SQL functions take a bare order id and would otherwise expose
 * any conversation to any authenticated user.
 */
async function assertOwnsOrder(
  supabase: ReturnType<typeof createClient>,
  orderId: unknown,
  telegramUserId: number,
): Promise<boolean> {
  if (typeof orderId !== "string" || !orderId) return false;
  const { data } = await supabase
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();
  return !!data;
}

/**
 * Escape user-supplied text before interpolating it into a Telegram message
 * sent with parse_mode: HTML. Without this, a customer writing "<b>" either
 * injects markup into the admin's chat or makes Telegram reject the whole
 * message as malformed, silently dropping the notification.
 *
 * Only `& < >` on purpose — this is NOT the same job as the escaper in
 * api/product-preview.ts, which also covers quotes because it writes into HTML
 * attributes. Telegram's HTML parse mode understands a fixed set of tags and no
 * attributes, so these three characters are the whole attack surface; escaping
 * quotes here would put a literal `&quot;` in front of the shop's staff.
 * The two look like duplicates and are not, which is why neither is shared.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/*
 * Уведомления администратору отправляет общий модуль _shared/telegram-notify.ts.
 *
 * Здесь была своя копия на восемь строк, и она не проверяла resp.ok, не
 * повторяла попытку и глотала любую ошибку в пустой catch. Telegram ограничивает
 * частоту сообщений в один чат, и на всплеске отказ приходил ответом 429 — то
 * есть без исключения. Сообщение просто исчезало, в логах не оставалось ничего.
 * Отсюда и «иногда приходит, иногда нет». Общий модуль проверяет ответ, трижды
 * повторяет попытку на временных сбоях и пишет в лог, если так и не вышло.
 */

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // x-forwarded-for is a comma-separated chain; the client is the first entry.
  // Using the whole header let a caller vary it per request and get a fresh
  // budget each time.
  const ip = (req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown")
    .split(",")[0]
    .trim() || "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded", retry_after: rate.retryAfterSeconds }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Retry-After": String(rate.retryAfterSeconds),
        },
      }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const botToken = getBotToken();
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { action, admin_session, init_data, ...params } = await req.json();

    console.log(`[ClientAPI] Action: ${action}`, {
      hasInitData: !!init_data,
      hasAdminSession: !!admin_session,
    });

    if (!action) {
      return new Response(
        JSON.stringify({ error: "Missing action" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify admin session for admin-only actions.
    // NOTE: verifyAdminSession returns a result object — checking it for
    // truthiness instead of reading `.ok` would pass for every caller.
    if (ADMIN_ACTIONS.includes(action)) {
      const auth = await verifyAdminSession(supabase, admin_session);
      if (!auth.ok) {
        return new Response(
          JSON.stringify({ error: auth.error ?? "Admin session required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── Telegram identity: MANDATORY for every user-scoped action ────────────
    //
    // Fails closed. The caller's telegram_user_id is never taken from the
    // request body — it is overwritten with the id inside the cryptographically
    // verified initData, so a client can only ever act as itself.
    if (USER_SCOPED_ACTIONS.includes(action)) {
      if (!botToken) {
        // Refuse rather than fall through unauthenticated.
        console.error("[ClientAPI] TELEGRAM_BOT_TOKEN/BOT_TOKEN is not set — cannot verify identity");
        return new Response(
          JSON.stringify({ error: "Server misconfigured: bot token missing" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!init_data) {
        return new Response(
          JSON.stringify({ error: "Telegram initData is required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const verification = await verifyTelegramInitData(init_data, botToken);
      if (!verification.valid || !verification.user) {
        console.error(`[ClientAPI] initData rejected for "${action}": ${verification.error}`);
        return new Response(
          JSON.stringify({ error: "Invalid Telegram session" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Authoritative identity — overwrites anything the client sent.
      params.p_telegram_user_id = verification.user.id;
      params.p_telegram_id = verification.user.id;
      console.log(`[ClientAPI] "${action}" authenticated as ${verification.user.id}`);
    }

    let result;
    switch (action) {
      case "upsert_user": {
        const { data, error } = await supabase.rpc("upsert_user", {
          p_telegram_id: params.p_telegram_id,
          p_first_name: params.p_first_name,
          p_username: params.p_username ?? null,
          p_language: params.p_language ?? "ru",
          p_phone: params.p_phone ?? null,
          p_address: params.p_address ?? null,
          p_latitude: params.p_latitude ?? null,
          p_longitude: params.p_longitude ?? null,
        }).single();
        if (error) {
          console.error(`[ClientAPI] upsert_user RPC error:`, error);
          throw error;
        }
        console.log(`[ClientAPI] upsert_user success:`, { id: data?.id, telegram_id: data?.telegram_id });
        result = data;

        /*
         * «Новый пользователь» — только когда строка действительно создана.
         *
         * upsert_user вызывается при каждом запуске приложения (src/main.tsx),
         * при сохранении профиля и при оформлении заказа. Уведомление стояло на
         * самом факте вызова, поэтому постоянный покупатель объявлялся новым
         * при каждом открытии магазина, а настоящие новички терялись в потоке
         * одинаковых сообщений.
         *
         * INSERT ставит created_at и updated_at из одного now() транзакции —
         * они совпадают до микросекунды. Ветка ON CONFLICT трогает только
         * updated_at, так что для существующего пользователя значения всегда
         * разные. Отдельный запрос к базе для этого не нужен.
         */
        const row = data as { created_at?: string; updated_at?: string } | null;
        const isNewUser = Boolean(row?.created_at) && row?.created_at === row?.updated_at;
        if (isNewUser) {
          const displayName = escapeHtml(String(params.p_first_name || "Без имени"));
          const username = params.p_username ? ` (@${escapeHtml(String(params.p_username))})` : "";
          console.log(`[ClientAPI] новый пользователь ${params.p_telegram_id}, отправляю уведомление`);
          await notifyAdmin(
            `👤 <b>Новый пользователь</b>\n\n` +
            `Имя: ${displayName}${username}\n` +
            `Telegram ID: ${params.p_telegram_id}`
          );
        }
        break;
      }
      case "upload_review_photo":
      case "upload_return_photo": {
        const bucket = action === "upload_review_photo" ? "review-photos" : "return-photos";
        const upload = await uploadImage(supabase, {
          bucket,
          content_base64: String(params.content_base64 ?? ""),
          content_type: String(params.content_type ?? ""),
          prefix: action === "upload_review_photo" ? "reviews" : "returns",
        }, [bucket]);
        if (!upload.ok) {
          return new Response(
            JSON.stringify({ error: upload.error }),
            { status: upload.status ?? 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // `path` уходит в базу, `url` — временная ссылка для предпросмотра в форме.
        result = { path: upload.path, url: upload.url };
        break;
      }

      case "get_product_reviews": {
        const { data, error } = await supabase
          .from("reviews")
          .select("*")
          .eq("product_id", params.p_product_id)
          .eq("is_approved", true)
          .order("created_at", { ascending: false });
        if (error) throw error;
        result = await Promise.all((data ?? []).map(async (review) => ({
          ...review,
          photos: await signPaths(supabase, "review-photos", review.photos),
          images: await signPaths(supabase, "review-photos", review.images),
        })));
        break;
      }

      // ── Reads scoped to the verified caller ────────────────────────────────
      case "get_client_orders": {
        const { data, error } = await supabase.rpc("get_client_orders", {
          p_telegram_user_id: params.p_telegram_user_id,
        });
        if (error) throw error;
        result = data ?? [];
        break;
      }
      case "get_client_favorites": {
        const { data, error } = await supabase.rpc("get_client_favorites", {
          p_telegram_user_id: params.p_telegram_user_id,
        });
        if (error) throw error;
        result = data ?? [];
        break;
      }

      case "get_user_profile": {
        const { data, error } = await supabase
          .from("users")
          .select("id, telegram_id, first_name, username, language, phone, address, latitude, longitude, created_at, updated_at")
          .eq("telegram_id", params.p_telegram_user_id)
          .maybeSingle();
        if (error) throw error;
        result = data;
        break;
      }

      case "get_notifications": {
        const { data, error } = await supabase
          .from("notifications")
          .select("*")
          .eq("telegram_user_id", params.p_telegram_user_id)
          .order("created_at", { ascending: false })
          .limit(30);
        if (error) throw error;
        result = data ?? [];
        break;
      }

      case "get_unread_notification_count": {
        const { count, error } = await supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("telegram_user_id", params.p_telegram_user_id)
          .eq("is_read", false);
        if (error) throw error;
        result = count ?? 0;
        break;
      }

      case "get_user_returns": {
        const { data, error } = await supabase
          .from("returns")
          .select("*")
          .eq("telegram_user_id", params.p_telegram_user_id)
          .order("created_at", { ascending: false });
        if (error) throw error;
        result = await Promise.all((data ?? []).map(async (ret) => ({
          ...ret,
          photos: await signPaths(supabase, "return-photos", ret.photos),
        })));
        break;
      }

      case "validate_coupon": {
        // Same module checkout uses, so the preview and the charge agree.
        const subtotal = Number(params.p_subtotal);
        if (!Number.isFinite(subtotal) || subtotal < 0) {
          return new Response(
            JSON.stringify({ error: "Invalid subtotal" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        result = await validateCoupon(supabase, {
          code: String(params.p_code ?? ""),
          telegramUserId: params.p_telegram_user_id as number,
          subtotal,
        });
        break;
      }

      // ── Order chat, restricted to the caller's own orders ──────────────────
      case "get_order_messages": {
        if (!await assertOwnsOrder(supabase, params.p_order_id, params.p_telegram_user_id as number)) {
          return new Response(
            JSON.stringify({ error: "Order not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const { data, error } = await supabase.rpc("get_order_messages", {
          p_order_id: params.p_order_id,
        });
        if (error) throw error;
        result = data ?? [];
        break;
      }
      case "send_message": {
        if (!await assertOwnsOrder(supabase, params.p_order_id, params.p_telegram_user_id as number)) {
          return new Response(
            JSON.stringify({ error: "Order not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const content = typeof params.p_content === "string" ? params.p_content.trim() : "";
        if (!content || content.length > 2000) {
          return new Response(
            JSON.stringify({ error: "Message must be 1-2000 characters" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // sender_type/sender_id are forced — a customer can never post as admin.
        const { data, error } = await supabase.rpc("send_message", {
          p_order_id: params.p_order_id,
          p_sender_type: "customer",
          p_sender_id: String(params.p_telegram_user_id),
          p_receiver_id: "admin",
          p_content: content,
        }).single();
        if (error) throw error;
        result = data;

        // Ping the admin on Telegram. This used to be a direct browser call to
        // the send-message function with a hard-coded admin chat id and no
        // authentication; it belongs here, where the sender is already verified
        // and the admin id comes from the environment.
        if (botToken) {
          const shortOrderId = String(params.p_order_id).slice(0, 8).toUpperCase();
          await notifyAdmin(
            `💬 <b>Новое сообщение по заказу #${shortOrderId}</b>\n\n` +
            `👤 ID: ${params.p_telegram_user_id}\n` +
            `─────────────────\n` +
            `${escapeHtml(content.slice(0, 500))}`
          );
        }
        break;
      }
      case "mark_messages_read": {
        if (!await assertOwnsOrder(supabase, params.p_order_id, params.p_telegram_user_id as number)) {
          return new Response(
            JSON.stringify({ error: "Order not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const { error } = await supabase.rpc("mark_messages_read", {
          p_order_id: params.p_order_id,
          p_sender_id: String(params.p_telegram_user_id),
        });
        if (error) throw error;
        result = { ok: true };
        break;
      }
      case "get_unread_message_count": {
        const { data, error } = await supabase.rpc("get_unread_message_count", {
          p_sender_id: String(params.p_telegram_user_id),
        });
        if (error) throw error;
        result = data ?? 0;
        break;
      }

      case "add_favorite": {
        const { error } = await supabase.rpc("add_favorite", {
          p_telegram_user_id: params.p_telegram_user_id,
          p_product_id: params.p_product_id,
          p_notify_price: params.p_notify_price ?? false,
          p_notify_stock: params.p_notify_stock ?? false,
        });
        if (error) throw error;
        result = { ok: true };
        break;
      }
      case "remove_favorite": {
        const { error } = await supabase.rpc("remove_favorite", {
          p_telegram_user_id: params.p_telegram_user_id,
          p_product_id: params.p_product_id,
        });
        if (error) throw error;
        result = { ok: true };
        break;
      }
      case "update_favorite": {
        const { error } = await supabase.rpc("update_favorite", {
          p_telegram_user_id: params.p_telegram_user_id,
          p_product_id: params.p_product_id,
          p_notify_price: params.p_notify_price ?? null,
          p_notify_stock: params.p_notify_stock ?? null,
        });
        if (error) throw error;
        result = { ok: true };
        break;
      }
      case "insert_review": {
        const { data, error } = await supabase.rpc("insert_review", {
          p_product_id: params.p_product_id,
          p_telegram_user_id: params.p_telegram_user_id,
          p_user_name: params.p_user_name,
          p_rating: params.p_rating,
          p_comment: params.p_comment ?? null,
          p_images: params.p_images ?? [],
          p_photos: params.p_photos ?? [],
        }).single();
        if (error) throw error;
        result = data;
        break;
      }
      case "mark_notification_read": {
        // mark_notification_read() takes only a notification id, so ownership
        // has to be established here before calling it.
        const { data: owned } = await supabase
          .from("notifications")
          .select("id")
          .eq("id", params.p_id)
          .eq("telegram_user_id", params.p_telegram_user_id)
          .maybeSingle();
        if (!owned) {
          return new Response(
            JSON.stringify({ error: "Notification not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const { error } = await supabase.rpc("mark_notification_read", {
          p_id: params.p_id,
        });
        if (error) throw error;
        result = { ok: true };
        break;
      }
      case "mark_all_notifications_read": {
        const { error } = await supabase.rpc("mark_all_notifications_read", {
          p_telegram_user_id: params.p_telegram_user_id,
        });
        if (error) throw error;
        result = { ok: true };
        break;
      }
      case "clear_read_notifications": {
        const { error } = await supabase.rpc("clear_read_notifications", {
          p_telegram_user_id: params.p_telegram_user_id,
        });
        if (error) throw error;
        result = { ok: true };
        break;
      }
      case "insert_notification": {
        const { data, error } = await supabase.rpc("insert_notification", {
          p_telegram_user_id: params.p_telegram_user_id,
          p_type: params.p_type,
          p_title: params.p_title,
          p_body: params.p_body,
          p_data: params.p_data ?? {},
        }).single();
        if (error) throw error;
        result = data;
        break;
      }
      case "insert_return": {
        const { data, error } = await supabase.rpc("insert_return", {
          p_telegram_user_id: params.p_telegram_user_id,
          p_order_id: params.p_order_id,
          p_items: params.p_items,
          p_reason: params.p_reason,
          p_photos: params.p_photos ?? [],
        }).single();
        if (error) throw error;
        result = data;

        // Notify admin about new return
        if (botToken) {
          const shortOrderId = String(params.p_order_id).slice(0, 8).toUpperCase();
          const itemsArr = Array.isArray(params.p_items) ? params.p_items : [];
          const itemsList = itemsArr.map((it: { name?: string }) => `  • ${escapeHtml(String(it.name || "Товар"))}`).join("\n");
          await notifyAdmin(
            `🔄 <b>Новая заявка на возврат</b>\n\n` +
            `📦 Заказ: #${shortOrderId}\n` +
            `👤 Пользователь: ${params.p_telegram_user_id}\n` +
            `📝 Причина: ${escapeHtml(String(params.p_reason))}\n` +
            (itemsList ? `📋 Товары:\n${itemsList}` : "")
          );
        }
        break;
      }
      case "record_coupon_usage": {
        const { error } = await supabase.rpc("record_coupon_usage", {
          p_coupon_id: params.p_coupon_id,
          p_telegram_user_id: params.p_telegram_user_id,
          p_order_id: params.p_order_id ?? null,
        });
        if (error) throw error;
        result = { ok: true };
        break;
      }
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
