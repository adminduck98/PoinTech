import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { notifyNewOrder } from "../_shared/telegram-notify.ts";
import { getBotToken, verifyTelegramInitData } from "../_shared/telegram-verify.ts";
import { validateCoupon } from "../_shared/coupons.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

interface OrderItem {
  productId: string;
  name: { ru: string; uz: string } | string;
  price: number;
  quantity: number;
  size?: string;
  color?: string;
  image?: string;
}

interface CheckoutRequest {
  telegram_user_id: number;
  items: OrderItem[];
  total_amount: number;
  customer_info: {
    name: string;
    phone: string;
    city: string;
    address: string;
    zone_id?: string;
    region?: string;
    latitude?: number | null;
    longitude?: number | null;
  };
  delivery_type: string;
  delivery_cost: number;
  payment_method: string;
  notes?: string;
  coupon_id?: string;
  discount_amount?: number;
  init_data?: string;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body: CheckoutRequest = await req.json();

    console.log("[Checkout] Request received:", {
      hasInitData: !!body.init_data,
      itemsCount: body.items?.length,
      payment_method: body.payment_method,
    });

    // ── Telegram identity: MANDATORY, fails closed ───────────────────────────
    // The order is attributed to the id inside the verified initData, never to
    // the telegram_user_id supplied in the request body.
    const botToken = getBotToken();
    if (!botToken) {
      console.error("[Checkout] TELEGRAM_BOT_TOKEN/BOT_TOKEN is not set — cannot verify identity");
      return new Response(
        JSON.stringify({ error: "Server misconfigured: bot token missing" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!body.init_data) {
      return new Response(
        JSON.stringify({ error: "Telegram initData is required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const verification = await verifyTelegramInitData(body.init_data, botToken);
    if (!verification.valid || !verification.user) {
      console.error(`[Checkout] initData rejected: ${verification.error}`);
      return new Response(
        JSON.stringify({ error: "Invalid Telegram session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Authoritative buyer identity — overwrites whatever the client claimed.
    const telegramUserId = verification.user.id;
    console.log(`[Checkout] authenticated as ${telegramUserId}`);

    // Validate required fields
    if (!body.items?.length) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate customer info
    if (!body.customer_info?.name || !body.customer_info?.phone || !body.customer_info?.address) {
      return new Response(
        JSON.stringify({ error: "Missing customer info" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Money is recomputed from the database, never taken from the client ───
    //
    // Item prices used to be *compared* against the database, but the order's
    // total_amount was written straight from the request body. A client could
    // therefore send correctly-priced items and total_amount: 1. Everything
    // downstream — the payment link, Payme's amount check, the admin dashboard,
    // revenue reporting — trusts orders.total_amount, so that single unchecked
    // field undercut every other price check in this function.
    //
    // Below, subtotal, delivery and discount are all derived server-side and
    // the client's figure is only used to detect that its cart went stale.

    // Aggregate quantities per product first: the same product can legitimately
    // appear as several lines (different size/colour), and stock must be
    // checked against the combined quantity, not each line separately.
    const quantityByProduct = new Map<string, number>();
    for (const item of body.items) {
      if (!item?.productId || typeof item.productId !== "string") {
        return new Response(
          JSON.stringify({ error: "Invalid item in cart" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const qty = Number(item.quantity);
      if (!Number.isInteger(qty) || qty <= 0 || qty > 1000) {
        return new Response(
          JSON.stringify({ error: `Invalid quantity for product ${item.productId}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      quantityByProduct.set(item.productId, (quantityByProduct.get(item.productId) ?? 0) + qty);
    }

    const productIds = [...quantityByProduct.keys()];
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, name, price, stock, is_active, images")
      .in("id", productIds);

    if (productsError) throw productsError;

    const productById = new Map(
      (products ?? []).map((p) => [p.id as string, p as Record<string, unknown>])
    );

    for (const productId of productIds) {
      const product = productById.get(productId);
      if (!product) {
        return new Response(
          JSON.stringify({ error: `Product ${productId} not found` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!product.is_active) {
        return new Response(
          JSON.stringify({ error: `Product ${productId} is not available` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const needed = quantityByProduct.get(productId) ?? 0;
      if (Number(product.stock) < needed) {
        return new Response(
          JSON.stringify({ error: `Insufficient stock for product ${productId}. Available: ${product.stock}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Rebuild the line items from the database so the stored order, the totals
    // and the stock deduction can never disagree with each other.
    const items: OrderItem[] = body.items.map((item) => {
      const product = productById.get(item.productId)!;
      const images = Array.isArray(product.images) ? product.images as string[] : [];
      return {
        productId: item.productId,
        name: product.name as { ru: string; uz: string },
        price: Number(product.price),
        quantity: Number(item.quantity),
        size: item.size,
        color: item.color,
        image: images[0] ?? item.image,
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    // ── Delivery cost, from the zone table ───────────────────────────────────
    const deliveryType = body.delivery_type === "express" ? "express" : "standard";
    let deliveryCost = 0;
    const zoneId = body.customer_info?.zone_id;

    if (zoneId) {
      const { data: zone } = await supabase
        .from("delivery_zones")
        .select("id, standard_price, express_price, free_threshold, is_active")
        .eq("id", zoneId)
        .maybeSingle();

      if (!zone || !zone.is_active) {
        return new Response(
          JSON.stringify({ error: "Delivery zone is not available" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      deliveryCost = deliveryType === "express"
        ? Number(zone.express_price)
        : Number(zone.standard_price);

      // Free standard delivery above the zone's threshold.
      const threshold = zone.free_threshold === null ? null : Number(zone.free_threshold);
      if (deliveryType === "standard" && threshold && threshold > 0 && subtotal >= threshold) {
        deliveryCost = 0;
      }
    } else {
      // No zone selected — fall back to whatever the client proposed, but never
      // let it be negative (a negative delivery cost would reduce the total).
      deliveryCost = Math.max(0, Number(body.delivery_cost) || 0);
    }

    // ── Coupon: full validation via the module the cart preview also uses ────
    let discountAmount = 0;
    if (body.coupon_id) {
      const result = await validateCoupon(supabase, {
        couponId: body.coupon_id,
        telegramUserId,
        subtotal,
      });
      if (!result.valid) {
        return new Response(
          JSON.stringify({ error: result.error ?? "Invalid coupon" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      discountAmount = result.discount;
    }

    // ── Authoritative total ─────────────────────────────────────────────────
    const totalAmount = Math.max(0, subtotal + deliveryCost - discountAmount);

    // The client's figure is advisory: if it disagrees, its cart or the prices
    // moved underneath it. Refuse rather than silently charging a different
    // amount than the one the customer just confirmed on screen.
    const clientTotal = Number(body.total_amount);
    if (Number.isFinite(clientTotal) && Math.abs(clientTotal - totalAmount) > 1) {
      console.warn(`[Checkout] total mismatch: client=${clientTotal} server=${totalAmount} (subtotal=${subtotal} delivery=${deliveryCost} discount=${discountAmount})`);
      return new Response(
        JSON.stringify({
          error: "Order total has changed. Please review your cart and try again.",
          expected_total: totalAmount,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Checkout] totals subtotal=${subtotal} delivery=${deliveryCost} discount=${discountAmount} total=${totalAmount}`);

    // Create order with atomic stock deduction using a transaction
    const { data: orderResult, error: orderError } = await supabase.rpc("create_order_with_stock", {
      p_telegram_user_id: telegramUserId,
      p_items: items,
      p_total_amount: totalAmount,
      p_customer_info: body.customer_info,
      p_delivery_type: deliveryType,
      p_delivery_cost: deliveryCost,
      p_payment_method: body.payment_method,
      p_notes: body.notes || null,
      p_coupon_id: body.coupon_id || null,
      p_discount_amount: discountAmount,
      p_status: body.payment_method === "cash" ? "new" : "processing",
    });

    const order = Array.isArray(orderResult) ? orderResult[0] : orderResult;

    if (orderError || !order) {
      console.error("[Checkout] Order creation FAILED:", orderError);
      return new Response(
        JSON.stringify({ error: orderError?.message || "Failed to create order" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[Checkout] Order created successfully:", { id: order.id, status: order.status });

    // Record coupon usage if applicable
    if (body.coupon_id) {
      try {
        await supabase.from("coupon_usage").insert({
          coupon_id: body.coupon_id,
          telegram_user_id: telegramUserId,
          order_id: order.id,
        });
      } catch { /* non-critical */ }
    }

    // Log the order creation
    try {
      await supabase.from("audit_log").insert({
        admin_id: "system",
        action: "order_created",
        entity_type: "orders",
        entity_id: order.id,
        details: {
          telegram_user_id: telegramUserId,
          total_amount: totalAmount,
          payment_method: body.payment_method,
          items_count: items.length,
        },
      });
    } catch { /* non-critical */ }

    // Notify admin about new order
    await notifyNewOrder({
      orderId: order.id,
      totalAmount: totalAmount,
      paymentMethod: body.payment_method,
      customerName: body.customer_info.name,
      customerPhone: body.customer_info.phone,
      customerCity: body.customer_info.city,
      customerAddress: body.customer_info.address,
      items: items.map((it) => ({
        name: typeof it.name === "object" ? (it.name as { ru: string }).ru : String(it.name),
        quantity: it.quantity,
      })),
    });

    return new Response(
      JSON.stringify({
        success: true,
        order: {
          id: order.id,
          status: order.status,
          total_amount: order.total_amount,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Checkout error:", error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: "Internal error", detail: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
