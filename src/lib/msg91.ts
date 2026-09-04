/**
 * MSG91 SMS helper — OTP delivery via the Flow API.
 *
 * We self-generate the OTP (see otp-store.ts) and send it through MSG91's
 * DLT-approved transactional template. MSG91 renders the EXACT approved text
 * server-side from `template_id`; we only inject the OTP value, so the
 * delivered message always matches the registered template:
 *
 *   "Dear Customer ##numeric## is your OTP for Cadieux Valid for 10 minutes
 *    Do not share this OTP with anyone Core Element"
 *
 * The template variable is `numeric` — the OTP is passed as `{ numeric: otp }`
 * in the recipient object.
 *
 * Required env:
 *   MSG91_AUTH_KEY        - account auth key (SECRET, server-only)
 *   MSG91_OTP_TEMPLATE_ID - DLT-approved OTP flow template id
 * Optional env:
 *   MSG91_SENDER_ID       - DLT sender/header (defaults to "COELNT")
 */

const FLOW_URL = "https://control.msg91.com/api/v5/flow/";
const DEFAULT_SENDER = "COELNT";

/** Normalise to MSG91's `91XXXXXXXXXX` form (12 digits, no `+`). */
function normalize(raw: string): string {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits.replace(/^0+/, "");
}

type Result = { ok: true } | { ok: false; error: string };

/**
 * Sends a self-generated OTP via the MSG91 flow template. Returns a tagged
 * result; callers map a failure to a 5xx. Never throws.
 */
export async function sendOtpSms(phone: string, otp: string): Promise<Result> {
  const authkey = process.env.MSG91_AUTH_KEY;
  if (!authkey) return { ok: false, error: "MSG91_AUTH_KEY not configured" };

  const template_id = process.env.MSG91_OTP_TEMPLATE_ID;
  if (!template_id) {
    return { ok: false, error: "MSG91_OTP_TEMPLATE_ID not configured" };
  }

  const sender = process.env.MSG91_SENDER_ID ?? DEFAULT_SENDER;
  const mobiles = normalize(phone);
  if (mobiles.length !== 12) return { ok: false, error: "Invalid phone" };

  try {
    const res = await fetch(FLOW_URL, {
      method: "POST",
      headers: {
        authkey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        template_id,
        sender,
        short_url: "0",
        // `numeric` matches the ##numeric## variable in the approved template.
        recipients: [{ mobiles, numeric: otp }],
      }),
    });
    const data = await res
      .json()
      .catch(() => ({}) as Record<string, unknown>);
    if (!res.ok || (data as { type?: string }).type === "error") {
      const msg =
        (data as { message?: string }).message ?? `MSG91 HTTP ${res.status}`;
      console.error("MSG91 flow error:", data);
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (err) {
    console.error("MSG91 fetch failed:", err);
    return { ok: false, error: "MSG91 request failed" };
  }
}

// ── Generic Flow-template sender ────────────────────────────────────────────
//
// Same Flow API + auth as sendOtpSms — but any DLT template, any variables.
// Added for the pre-order schedule notification (see lib/preorder-notify.ts);
// the sendOtpSms helper above is intentionally left byte-identical so the OTP
// path is untouched.
//
// `variables` is spread into the recipient object alongside `mobiles`, so
// each key must match a `##<name>##` placeholder in the approved template.
// Example: template with `##order_number##` + `##date##` → pass
// `{ order_number: "CX-7K4M2P", date: "2026-09-01" }`.
//
// NOTE the placeholder NAME is `order_number` because that is what was
// approved on the DLT side and cannot be changed — but the VALUE must be
// `orders.public_ref`, never `orders.order_number`. The OLF number is
// sequential and would disclose our order volume to the recipient.

/** Send a self-generated MSG91 Flow template. Returns tagged result — never
 *  throws. Caller supplies the template id (from env) + variable map. */
export async function sendMsg91FlowTemplate(
  phone: string,
  template_id: string,
  variables: Record<string, string>,
): Promise<Result> {
  const authkey = process.env.MSG91_AUTH_KEY;
  if (!authkey) return { ok: false, error: "MSG91_AUTH_KEY not configured" };
  if (!template_id) return { ok: false, error: "template_id missing" };

  const sender = process.env.MSG91_SENDER_ID ?? DEFAULT_SENDER;
  const mobiles = normalize(phone);
  if (mobiles.length !== 12) return { ok: false, error: "Invalid phone" };

  try {
    const res = await fetch(FLOW_URL, {
      method: "POST",
      headers: {
        authkey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        template_id,
        sender,
        short_url: "0",
        recipients: [{ mobiles, ...variables }],
      }),
    });
    const data = await res
      .json()
      .catch(() => ({}) as Record<string, unknown>);
    if (!res.ok || (data as { type?: string }).type === "error") {
      const msg =
        (data as { message?: string }).message ?? `MSG91 HTTP ${res.status}`;
      console.error("[msg91-flow] template send failed:", {
        template_id,
        error: msg,
        data,
      });
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (err) {
    console.error("[msg91-flow] fetch failed:", err);
    return { ok: false, error: "MSG91 request failed" };
  }
}
