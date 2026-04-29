/**
 * MSG91 SMS helper — flow API.
 *
 * Required env:
 *   MSG91_AUTH_KEY     - account auth key
 *   MSG91_TEMPLATE_ID  - DLT-approved flow template id (sender CADEUX, route 4)
 *
 * The flow template must declare a single variable named `message` (used by
 * `sendSMS`) and `otp` (used by `sendOTP`). Both helpers post to the same
 * flow endpoint; if a separate OTP template is needed, set
 * MSG91_OTP_TEMPLATE_ID.
 *
 * Note: MSG91 sender IDs require DLT approval in India. Until "CADEUX" is
 * approved, MSG91 will substitute a default sender, but messages still
 * deliver.
 */

const FLOW_URL = "https://control.msg91.com/api/v5/flow/";
const SENDER = "CADEUX";
const ROUTE = "4"; // Transactional

function normalize(raw: string): string {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  // Strip leading 0s, fall back to digits as-is.
  return digits.replace(/^0+/, "");
}

type Result = { ok: true } | { ok: false; error: string };

async function postFlow(body: Record<string, unknown>): Promise<Result> {
  const authkey = process.env.MSG91_AUTH_KEY;
  if (!authkey) return { ok: false, error: "MSG91_AUTH_KEY not configured" };

  try {
    const res = await fetch(FLOW_URL, {
      method: "POST",
      headers: {
        authkey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
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

export async function sendSMS(phone: string, message: string): Promise<Result> {
  const template_id = process.env.MSG91_TEMPLATE_ID;
  if (!template_id) return { ok: false, error: "MSG91_TEMPLATE_ID not configured" };
  const mobiles = normalize(phone);
  if (!mobiles) return { ok: false, error: "Invalid phone" };

  return postFlow({
    template_id,
    sender: SENDER,
    short_url: "0",
    route: ROUTE,
    recipients: [{ mobiles, message }],
  });
}

export async function sendOTP(phone: string, otp: string): Promise<Result> {
  const template_id =
    process.env.MSG91_OTP_TEMPLATE_ID ?? process.env.MSG91_TEMPLATE_ID;
  if (!template_id) return { ok: false, error: "MSG91_TEMPLATE_ID not configured" };
  const mobiles = normalize(phone);
  if (!mobiles) return { ok: false, error: "Invalid phone" };

  return postFlow({
    template_id,
    sender: SENDER,
    short_url: "0",
    route: ROUTE,
    recipients: [{ mobiles, otp }],
  });
}
