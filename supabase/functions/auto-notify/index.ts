import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from "npm:@supabase/supabase-js@2";
import { getBotToken, isInternalServiceCall } from "../_shared/env.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Internal call only — admin-api triggers this after a price/stock change.
  if (!isInternalServiceCall(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { product_id, type } = await req.json();

    if (!product_id || !type) {
      return new Response(
        JSON.stringify({ error: "product_id and type required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate type
    if (type !== "price_drop" && type !== "stock_available") {
      return new Response(
        JSON.stringify({ error: "type must be 'price_drop' or 'stock_available'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get product info
    const { data: product } = await supabase
      .from("products")
      .select("id, name, price, slug")
      .eq("id", product_id)
      .maybeSingle();

    if (!product) {
      return new Response(
        JSON.stringify({ error: "Product not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const productName = typeof product.name === "object"
      ? (product.name as { ru: string }).ru
      : product.name;

    // Get users to notify
    const field = type === "price_drop" ? "notify_price" : "notify_stock";
    const { data: favorites } = await supabase
      .from("favorites")
      .select("telegram_user_id")
      .eq("product_id", product_id)
      .eq(field, true);

    if (!favorites || favorites.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No users to notify" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const chatIds = [...new Set(favorites.map((f) => f.telegram_user_id))];
    let sent = 0;
    let errors = 0;

    const botToken = getBotToken();

    for (const chatId of chatIds) {
      try {
        // Create in-app notification
        await supabase.rpc("insert_notification", {
          p_telegram_user_id: chatId,
          p_type: type,
          p_title: type === "price_drop"
            ? `Цена снижена: ${productName}`
            : `В наличии: ${productName}`,
          p_body: type === "price_drop"
            ? `Новая цена: ${product.price} сум`
            : "Товар снова доступен для заказа",
          p_data: { product_id, slug: product.slug },
        });

        // Send Telegram notification
        if (botToken) {
          const text = type === "price_drop"
            ? `🔥 Товар стал дешевле!\n\n📦 ${productName}\n💰 Новая цена: ${product.price} сум\n\nОткройте каталог, чтобы оформить заказ.`
            : `📦 Товар снова в наличии!\n\n📦 ${productName}\n\nУспейте заказать!`;

          const response = await fetch(
            `https://api.telegram.org/bot${botToken}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: "HTML",
              }),
            }
          );

          if (response.ok) {
            sent++;
          } else {
            const errBody = await response.json().catch(() => ({}));
            const errDesc = (errBody as { description?: string }).description || `HTTP ${response.status}`;
            console.error(`[auto-notify] Failed for chat ${chatId}: ${errDesc}`);
            errors++;
          }
        } else {
          sent++;
        }
      } catch (e) {
        console.error(`[auto-notify] Exception for chat ${chatId}:`, e);
        errors++;
      }
      // Rate limit: 30 messages/sec max
      await new Promise((r) => setTimeout(r, 35));
    }

    return new Response(
      JSON.stringify({ success: true, sent, errors, total: chatIds.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Auto-notify error:", error);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
