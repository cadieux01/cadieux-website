// ---------------------------------------------------------------------------
// whatsapp-send — Supabase Edge Function (MSG91 WhatsApp send endpoint)
// ---------------------------------------------------------------------------
// Server-to-server WhatsApp send via MSG91. Replaces the Twilio sandbox path
// for the AI bot / future dashboard sends. Protected by the project's existing
// shared secret (INTERNAL_API_SECRET, header x-internal-secret).
//
// Supports two message types:
//   { "to": "<phone>", "type": "text", "text": "..." }
//       Free-form session message. GATED: only sent if the 24h customer-service
//       window is open (whatsapp_can_free_reply). If closed → 409 window_closed;
//       caller must fall back to a template. This is what the AI bot uses.
//   { "to": "<phone>", "type": "template", "template_name": "...",
//     "lang_code"?: "en", "components"?: {...} }
//       Approved template. Valid any time (and required outside the 24h window
//       or for marketing).
//
// Every successful send is recorded as an outbound row in whatsapp_messages.
//
// ENV
//   INTERNAL_API_SECRET       — shared secret for x-internal-secret (required)
//   MSG91_WHATSAPP_AUTHKEY    — MSG91 WhatsApp auth key
//   MSG91_INTEGRATED_NUMBER   — approved WhatsApp business number
//   MSG91_NAMESPACE           — template namespace
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — auto-injected
//
// DEPLOY (later — do NOT deploy yet). JWT stays ON (internal callers send the
// shared secret; the Supabase gateway apikey is still expected):
//   supabase functions deploy whatsapp-send --project-ref uejagupcwevadfhfuadv
// ---------------------------------------------------------------------------

import { constantTimeEqual, corsHeaders, json } from "../_shared/http.ts";
import {
  normalizePhone,
  sendWhatsAppTemplate,
  sendWhatsAppText,
} from "../_shared/msg91-whatsapp.ts";
import {
  canFreeReply,
  getOrCreateConversation,
  insertMessage,
  serviceClient,
} from "../_shared/whatsapp-store.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const INTERNAL_SECRET = Deno.env.get("INTERNAL_API_SECRET") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  if (!INTERNAL_SECRET) {
    console.error("[whatsapp-send] INTERNAL_API_SECRET unset");
    return json(500, { error: "Server mis-configured" });
  }
  const supplied = req.headers.get("x-internal-secret") ?? "";
  if (!supplied || !constantTimeEqual(supplied, INTERNAL_SECRET)) {
    return json(401, { error: "Unauthorized" });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return json(400, { error: "Body must be valid JSON" });
  }

  const to = typeof body.to === "string" ? body.to : "";
  const mobile = normalizePhone(to);
  if (!to || mobile.length !== 12) {
    return json(400, { error: "`to` must be a valid phone" });
  }
  const type = body.type === "template" ? "template" : "text";
  const admin = serviceClient();

  // ── TEMPLATE ────────────────────────────────────────────────────────────
  if (type === "template") {
    const templateName = typeof body.template_name === "string" ? body.template_name : "";
    if (!templateName) return json(400, { error: "`template_name` required for template" });

    const send = await sendWhatsAppTemplate(to, templateName, {
      langCode: typeof body.lang_code === "string" ? body.lang_code : undefined,
      components: (body.components as Record<string, unknown>) ?? undefined,
    });
    if (!send.ok) {
      console.error("[whatsapp-send] template send failed:", send.error);
      return json(502, { error: send.error });
    }
    try {
      const convId = await getOrCreateConversation(admin, mobile);
      await insertMessage(admin, {
        conversationId: convId,
        phone: mobile,
        direction: "outbound",
        body: `[template:${templateName}]`,
        waMessageId: send.waMessageId,
        status: "sent",
        aiGenerated: false,
        sentAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn("[whatsapp-send] store outbound (template) failed:", (e as Error).message);
    }
    return json(200, { ok: true, type: "template", wa_message_id: send.waMessageId });
  }

  // ── FREE-FORM TEXT (24h-gated) ───────────────────────────────────────────
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return json(400, { error: "`text` required for free-form" });

  const open = await canFreeReply(admin, mobile);
  if (!open) {
    return json(409, {
      error: "24h free-form window is closed for this number. Use a template.",
      window_closed: true,
    });
  }

  const send = await sendWhatsAppText(to, text);
  if (!send.ok) {
    console.error("[whatsapp-send] text send failed:", send.error, send.raw);
    // Include MSG91's raw body + status so the dashboard surfaces the
    // ACTUAL provider error (not the generic "MSG91 HTTP 400" fallback).
    // Callers should NOT depend on the shape of `msg91_raw` — it's a
    // debug passthrough of whatever MSG91 returned.
    return json(502, {
      error: send.error,
      msg91_status: send.status ?? null,
      msg91_raw: send.raw ?? null,
    });
  }
  try {
    const convId = await getOrCreateConversation(admin, mobile);
    await insertMessage(admin, {
      conversationId: convId,
      phone: mobile,
      direction: "outbound",
      body: text,
      waMessageId: send.waMessageId,
      status: "sent",
      aiGenerated: body.ai_generated === true,
      sentAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("[whatsapp-send] store outbound (text) failed:", (e as Error).message);
  }
  return json(200, { ok: true, type: "text", wa_message_id: send.waMessageId });
});
