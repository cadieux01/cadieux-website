// MSG91 WhatsApp send helper for Next.js (Node runtime).
//
// Ported from supabase/functions/_shared/msg91-whatsapp.ts (Deno edge). Same
// endpoints, same payload shapes, same credential env vars. Used by the
// pre-order schedule notification (see lib/preorder-notify.ts).
//
// Only the TEMPLATE path is exposed here — approved templates are the ONLY
// valid channel outside Meta's 24 h customer-service window (which we don't
// track on the website side). The session (free-form) endpoint is
// intentionally omitted.
//
// Required env:
//   MSG91_WHATSAPP_AUTHKEY   - WhatsApp API auth key
//   MSG91_INTEGRATED_NUMBER  - the approved WhatsApp business number
// Optional env:
//   MSG91_NAMESPACE          - WhatsApp template namespace (if MSG91 requires)
//   MSG91_WHATSAPP_LANG      - default template language code (defaults "en")
//
// Missing credentials → { ok:false, error:"credentials not configured" }. The
// caller (preorder-notify) turns that into a warn + skip, never a save-fail.

const MSG91_WA_BULK_URL =
  "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";

export type WhatsAppResult =
  | { ok: true; waMessageId: string | null }
  | { ok: false; error: string; status?: number };

/** Normalise to MSG91's `91XXXXXXXXXX` form (12 digits, no `+`). */
function normalizePhone(raw: string): string {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits.replace(/^0+/, "");
}

function extractMessageId(data: unknown): string | null {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.request_id === "string") return d.request_id;
  if (typeof d.requestId === "string") return d.requestId;
  const inner = d.data as Record<string, unknown> | undefined;
  if (inner) {
    if (typeof inner.request_id === "string") return inner.request_id;
    const msgs = inner.messages as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(msgs) && typeof msgs[0]?.id === "string") {
      return msgs[0].id as string;
    }
  }
  return null;
}

export type TemplateComponents = Record<string, unknown>;

/** Send an APPROVED WhatsApp template via MSG91's bulk endpoint. `components`
 *  matches MSG91's `to_and_components[0].components` shape — the schema
 *  depends on the template Meta approved (header/body/button variables). */
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  opts?: { langCode?: string; components?: TemplateComponents },
): Promise<WhatsAppResult> {
  const authkey = process.env.MSG91_WHATSAPP_AUTHKEY ?? "";
  const integrated = process.env.MSG91_INTEGRATED_NUMBER ?? "";
  const namespace = process.env.MSG91_NAMESPACE ?? "";
  const lang = opts?.langCode ?? process.env.MSG91_WHATSAPP_LANG ?? "en";

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
        language: { code: lang, policy: "deterministic" },
        ...(namespace ? { namespace } : {}),
        to_and_components: [
          { to: [mobile], components: opts?.components ?? {} },
        ],
      },
    },
  };

  try {
    const res = await fetch(MSG91_WA_BULK_URL, {
      method: "POST",
      headers: {
        authkey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    const rawText = await res.text().catch(() => "");
    let data: Record<string, unknown> = {};
    try {
      data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
    } catch {
      data = { _nonJsonBody: rawText };
    }
    const hasErrors =
      typeof (data as { errors?: unknown }).errors === "string" &&
      (data as { errors?: string }).errors!.trim().length > 0;
    if (!res.ok || (data as { type?: string }).type === "error" || hasErrors) {
      const msg =
        (data as { message?: string }).message ??
        (data as { errors?: string }).errors ??
        `MSG91 HTTP ${res.status}`;
      console.error(
        "[msg91-wa] SEND FAILED",
        JSON.stringify({
          endpoint: MSG91_WA_BULK_URL,
          status: res.status,
          errorMessage: msg,
          template: templateName,
          responseBody: data,
        }),
      );
      return { ok: false, error: msg, status: res.status };
    }
    return { ok: true, waMessageId: extractMessageId(data) };
  } catch (e) {
    console.error("[msg91-wa] SEND THREW", (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}
