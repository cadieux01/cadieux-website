// MSG91 WhatsApp send helpers (Deno). Production replacement for the Twilio
// sandbox. Two message types:
//   sendWhatsAppText     — free-form session message (ONLY valid inside the
//                          24h customer-service window; caller must gate).
//   sendWhatsAppTemplate — approved template (valid any time; required outside
//                          the 24h window and for marketing).
//
// Credentials are read from env — NEVER hardcoded:
//   MSG91_WHATSAPP_AUTHKEY   — WhatsApp API auth key
//   MSG91_INTEGRATED_NUMBER  — the approved WhatsApp business number
//   MSG91_NAMESPACE          — WhatsApp template namespace (template sends)
//   MSG91_WHATSAPP_LANG      — optional default template language (def "en")
//
// ENDPOINTS (MSG91 v5, same host as the OTP flow API):
//   SESSION  POST https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/
//            Flat body { integrated_number, recipient_number, content_type, text }.
//            Only valid inside Meta's 24h customer-service window (caller must
//            gate). MSG91 docs: /whatsapp/send-message-in-text.
//   BULK     POST https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/
//            Template-only. Nested payload/template/to_and_components shape.
//            MSG91 confirmed 2026-07-13: "for now, only template is supported for bulk".
//
// Both use header `authkey: <MSG91_WHATSAPP_AUTHKEY>`.

declare const Deno: { env: { get(key: string): string | undefined } };

// Free-form/session text — flat body, no /bulk/.
const MSG91_WA_SESSION_URL =
  "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/";
// Approved templates — bulk endpoint.
const MSG91_WA_BULK_URL =
  "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";

export type SendResult =
  | { ok: true; waMessageId: string | null; raw: unknown }
  | { ok: false; error: string; status?: number; raw?: unknown };

/** Normalise to MSG91's `91XXXXXXXXXX` form (12 digits, no `+`). */
export function normalizePhone(raw: string): string {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits.replace(/^0+/, "");
}

function creds() {
  return {
    authkey: Deno.env.get("MSG91_WHATSAPP_AUTHKEY") ?? "",
    integrated: Deno.env.get("MSG91_INTEGRATED_NUMBER") ?? "",
    namespace: Deno.env.get("MSG91_NAMESPACE") ?? "",
    lang: Deno.env.get("MSG91_WHATSAPP_LANG") ?? "en",
  };
}

// Best-effort extraction of a provider message id from MSG91's response so we
// can store it for idempotency / delivery tracking. Falls back to null.
function extractMessageId(data: unknown): string | null {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.request_id === "string") return d.request_id;
  if (typeof d.requestId === "string") return d.requestId;
  const inner = d.data as Record<string, unknown> | undefined;
  if (inner) {
    if (typeof inner.request_id === "string") return inner.request_id;
    const msgs = inner.messages as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(msgs) && typeof msgs[0]?.id === "string") return msgs[0].id as string;
  }
  return null;
}

async function postMsg91(url: string, body: unknown, authkey: string): Promise<SendResult> {
  const reqBodyStr = JSON.stringify(body);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authkey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: reqBodyStr,
    });
    // Read as text first so we log the ACTUAL response body even when it's not
    // valid JSON (MSG91 sometimes returns plain text on 4xx). Parse best-effort.
    const rawText = await res.text().catch(() => "");
    let data: Record<string, unknown> = {};
    try {
      data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
    } catch {
      data = { _nonJsonBody: rawText };
    }
    // MSG91 sometimes returns 200 with { errors: "..." } — treat that as failure.
    const hasErrors =
      typeof (data as { errors?: unknown }).errors === "string" &&
      (data as { errors?: string }).errors!.trim().length > 0;
    if (!res.ok || (data as { type?: string }).type === "error" || hasErrors) {
      const msg =
        (data as { message?: string }).message ??
        (data as { errors?: string }).errors ??
        `MSG91 HTTP ${res.status}`;
      // FULL diagnostic dump: endpoint, status, request payload, raw response.
      // Redact the authkey — never log secrets.
      console.error("[msg91-wa] SEND FAILED", JSON.stringify({
        endpoint: url,
        status: res.status,
        statusText: res.statusText,
        errorMessage: msg,
        requestPayload: body,
        responseBody: data,
        responseRawText: rawText,
      }));
      return { ok: false, error: msg, status: res.status, raw: data };
    }
    return { ok: true, waMessageId: extractMessageId(data), raw: data };
  } catch (e) {
    console.error("[msg91-wa] SEND THREW", JSON.stringify({
      endpoint: url,
      error: (e as Error).message,
      requestPayload: body,
    }));
    return { ok: false, error: (e as Error).message };
  }
}

/** Free-form text session message. Caller MUST have confirmed the 24h window
 *  is open (see whatsapp_can_free_reply / canFreeReply).
 *  Uses MSG91's SESSION endpoint (non-bulk) with the flat body shape:
 *  { integrated_number, recipient_number, content_type: "text", text }. */
export async function sendWhatsAppText(to: string, body: string): Promise<SendResult> {
  const { authkey, integrated } = creds();
  if (!authkey || !integrated) {
    return { ok: false, error: "MSG91 WhatsApp credentials not configured" };
  }
  const mobile = normalizePhone(to);
  if (mobile.length !== 12) return { ok: false, error: "Invalid phone" };

  const payload = {
    integrated_number: integrated,
    recipient_number: mobile,
    content_type: "text",
    text: body,
  };
  return postMsg91(MSG91_WA_SESSION_URL, payload, authkey);
}

export type TemplateComponents = Record<string, unknown>;

/** Approved template message. Valid any time; required outside the 24h window
 *  and for marketing. `components` is the MSG91 to_and_components body shape. */
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  opts?: { langCode?: string; components?: TemplateComponents },
): Promise<SendResult> {
  const { authkey, integrated, namespace, lang } = creds();
  if (!authkey || !integrated) {
    return { ok: false, error: "MSG91 WhatsApp credentials not configured" };
  }
  const mobile = normalizePhone(to);
  if (mobile.length !== 12) return { ok: false, error: "Invalid phone" };

  const payload = {
    integrated_number: integrated,
    content_type: "template",
    payload: {
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: templateName,
        language: { code: opts?.langCode ?? lang, policy: "deterministic" },
        ...(namespace ? { namespace } : {}),
        to_and_components: [
          { to: [mobile], components: opts?.components ?? {} },
        ],
      },
    },
  };
  return postMsg91(MSG91_WA_BULK_URL, payload, authkey);
}
