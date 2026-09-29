import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from "npm:@supabase/supabase-js@2";
import { getBotToken } from "../_shared/env.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { verifyAdminSession } from "../_shared/admin-auth.ts";

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

    const body = await req.json();
    const { telegram_user_id, message, parse_mode, admin_session } = body;

    const botToken = getBotToken();
    if (!botToken) {
      return new Response(
        JSON.stringify({ error: "Telegram bot token not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Authorisation: EVERY mode of this function requires an admin session ──
    //
    // This endpoint makes the shop's bot send arbitrary text to arbitrary
    // Telegram users. It previously required a session only when the caller
    // volunteered `sender_type: 'admin'`, so omitting that field turned the
    // shop's own bot into an open relay for spam and phishing.
    //
    // Customers never call this directly: the client-api `send_message` action
    // notifies the admin server-side after storing a chat message.
    const auth = await verifyAdminSession(supabase, admin_session);
    if (!auth.ok) {
      return new Response(
        JSON.stringify({ error: auth.error }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // NOTE: this function used to carry a "product notification" mode that
    // looped over `favorites` and messaged every watcher — a near-copy of
    // auto-notify, minus the in-app notification, so the bell icon stayed empty
    // for anyone notified this way. Admins now trigger auto-notify through
    // admin-api's notifyProductWatchers action, and there is one implementation.

    // ── Direct message mode (admin → a specific customer) ────────────────────
    if (!telegram_user_id || !message) {
      return new Response(
        JSON.stringify({ error: "telegram_user_id and message are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const recipientId = Number(telegram_user_id);
    if (!Number.isSafeInteger(recipientId) || recipientId <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid telegram_user_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const text = String(message).trim();
    if (!text || text.length > 4096) {
      return new Response(
        JSON.stringify({ error: "Message must be 1-4096 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: recipientId,
          text,
          parse_mode: parse_mode === "Markdown" ? "Markdown" : "HTML",
        }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("Telegram API error:", result);
      return new Response(
        JSON.stringify({
          success: false,
          error: result.description || "Failed to send message",
          error_code: result.error_code,
        }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message_id: result.result?.message_id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Send message error:", error);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
