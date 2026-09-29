import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getBotToken } from "../_shared/env.ts";
import { verifyTelegramInitData } from "../_shared/telegram-verify.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

interface PaymentRequest {
  orderId: string;
  amount: number;
  paymentMethod: 'payme' | 'click' | 'uzum';
  customerPhone?: string;
  init_data?: string;
}

interface PaymentResult {
  paymentUrl: string;
  transactionId: string;
}

/**
 * Which gateways can actually complete a payment.
 *
 * Click and Uzum are disabled because their callbacks do not exist: the payment
 * URLs built below point at /functions/v1/click-callback and
 * /functions/v1/uzum-callback, neither of which is implemented. A customer sent
 * to one of them could pay and the shop would never learn about it — the order
 * would sit in `processing` forever while the money left their account.
 *
 * Handing out such a URL is worse than refusing, so they are refused here until
 * the callbacks are written. The checkout UI already hides all three.
 */
const ENABLED_METHODS: ReadonlySet<string> = new Set(['payme']);
const ALL_METHODS = ['payme', 'click', 'uzum'];

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

    const { orderId, amount, paymentMethod, init_data }: PaymentRequest = await req.json();

    // ── Identity: only the buyer may start a payment for their own order ─────
    //
    // This endpoint used to be callable by anyone holding the public anon key.
    // Because it answers differently for an existing order with a matching
    // amount than for anything else, it doubled as an oracle: iterate order ids
    // and amounts to learn which orders exist and what they cost.
    const botToken = getBotToken();
    if (!botToken) {
      console.error('[CreatePayment] bot token is not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Server misconfigured' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (!init_data) {
      return new Response(
        JSON.stringify({ success: false, error: 'Telegram initData is required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const verification = await verifyTelegramInitData(init_data, botToken);
    if (!verification.valid || !verification.user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid Telegram session' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const telegramUserId = verification.user.id;

    // Validate input
    if (!orderId || !amount || amount <= 0) {
      throw new Error('Invalid payment parameters');
    }

    if (!ALL_METHODS.includes(paymentMethod)) {
      throw new Error('Invalid payment method');
    }

    if (!ENABLED_METHODS.has(paymentMethod)) {
      return new Response(
        JSON.stringify({ success: false, error: `Payment method "${paymentMethod}" is not available` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Get order details and verify amount matches
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, total_amount, status, payment_method, telegram_user_id')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError || !order) {
      throw new Error('Order not found');
    }

    // The order must belong to the caller.
    if (Number(order.telegram_user_id) !== telegramUserId) {
      throw new Error('Order not found');
    }

    // Verify amount matches order total (prevent tampering)
    if (Math.abs(Number(order.total_amount) - amount) > 1) {
      throw new Error('Amount mismatch');
    }

    // Verify order is in valid state for payment
    if (order.status === 'paid' || order.status === 'cancelled' || order.status === 'delivered') {
      throw new Error('Order not eligible for payment');
    }

    let paymentData: PaymentResult;

    switch (paymentMethod) {
      case 'payme':
        paymentData = await createPaymePayment(orderId, amount);
        break;
      default:
        throw new Error('Invalid payment method');
    }

    return new Response(
      JSON.stringify({
        success: true,
        paymentUrl: paymentData.paymentUrl,
        transactionId: paymentData.transactionId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error('Payment creation error:', error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function createPaymePayment(orderId: string, amount: number) {
  const merchantId = Deno.env.get("PAYME_MERCHANT_ID") ?? "";
  const baseUrl = Deno.env.get("PAYME_BASE_URL") ?? "https://checkout.paycom.uz";

  // Payme amount is in tiyin (1/100 sum)
  const amountInTiyin = Math.round(amount * 100);

  // Generate payment URL for Payme
  const params = new URLSearchParams({
    'm': merchantId,
    'ac.order_id': orderId,
    'a': amountInTiyin.toString(),
    // `c` is where Payme sends the *customer* after checkout — not the
    // merchant callback, which Payme calls server-to-server at the URL
    // configured in the merchant cabinet. It used to point at payme-callback,
    // dropping buyers onto a JSON-RPC endpoint.
    'c': Deno.env.get("PAYME_RETURN_URL") ?? Deno.env.get("WEBAPP_URL") ?? "",
  });

  const paymentUrl = `${baseUrl}?${params.toString()}`;

  return {
    paymentUrl,
    transactionId: `payme_${orderId}`,
  };
}

