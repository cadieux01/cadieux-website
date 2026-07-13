// Handoff email alert. Fires ONCE per new needs_human transition (caller
// gates on flagNeedsHumanIfNew's newlyFlagged=true). Uses Resend's REST API
// directly — no SDK — because the rest of this Edge Function stack is a Deno
// runtime and we deliberately avoid pulling npm modules.
//
// ENV
//   RESEND_API_KEY        — required. Same key the website's cron routes use.
//   HANDOFF_ALERT_EMAIL   — recipient. Defaults to "admin@cadieux.in" if unset.
//   RESEND_FROM_EMAIL     — sender. Defaults to "Cadieux <hello@cadieux.in>".
//   DASHBOARD_CHAT_URL    — optional deep-link base for the "open thread" CTA.
//                           Defaults to "https://www.cadieux.in/dashboard/admin/chat".
//
// Best-effort: any failure is logged and swallowed so the WhatsApp reply loop
// keeps running even if Resend has an outage.

declare const Deno: { env: { get(key: string): string | undefined } };

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type HandoffAlertInput = {
  conversationId: string;
  phone: string;
  reason: "handoff" | "fallback" | "send_failed" | "rate_limited";
  customerMessage: string;
  botReply: string;
  timestampIso: string;
};

const REASON_LABEL: Record<HandoffAlertInput["reason"], string> = {
  handoff: "Bot requested human handoff",
  fallback: "Bot could not generate a reply (fallback)",
  send_failed: "Bot reply failed to send",
  rate_limited: "Customer rate-limited (possible spam or urgency)",
};

function esc(s: string): string {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Fire-and-forget email alert. Returns { ok } for observability; never throws. */
export async function sendHandoffAlertEmail(
  input: HandoffAlertInput,
): Promise<{ ok: boolean; skipped?: string; error?: string; recipient?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!apiKey) {
    console.warn("[handoff-email] RESEND_API_KEY not set — skipping alert");
    return { ok: false, skipped: "no-api-key" };
  }
  const to = Deno.env.get("HANDOFF_ALERT_EMAIL") ?? "admin@cadieux.in";
  const from = Deno.env.get("RESEND_FROM_EMAIL") ?? "Cadieux <hello@cadieux.in>";
  const dashboardBase =
    Deno.env.get("DASHBOARD_CHAT_URL") ??
    "https://www.cadieux.in/dashboard/admin/chat";
  const deepLink = `${dashboardBase}?conversation=${encodeURIComponent(input.conversationId)}`;

  const reasonLabel = REASON_LABEL[input.reason] ?? input.reason;
  const subject = `[Cadieux WhatsApp] Handoff needed — ${input.phone}`;

  const html = `<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f5f2;color:#0e1a13;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e6e0cf;border-radius:12px;padding:24px;">
      <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#7a6a3a;font-weight:600;">Cadieux WhatsApp</div>
      <h1 style="margin:8px 0 4px 0;font-size:20px;color:#024628;">A customer needs a human</h1>
      <p style="margin:0 0 16px 0;font-size:14px;color:#334;">${esc(reasonLabel)}.</p>

      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr>
          <td style="padding:6px 0;color:#556;width:110px;">Phone</td>
          <td style="padding:6px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#111;">${esc(input.phone)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#556;">When</td>
          <td style="padding:6px 0;color:#111;">${esc(input.timestampIso)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#556;">Reason</td>
          <td style="padding:6px 0;color:#111;">${esc(input.reason)}</td>
        </tr>
      </table>

      <div style="margin-top:20px;padding:14px 16px;border-left:3px solid #024628;background:#f4f8f5;border-radius:0 6px 6px 0;">
        <div style="font-size:12px;color:#556;margin-bottom:4px;">Customer said</div>
        <div style="white-space:pre-wrap;font-size:14px;color:#111;">${esc(input.customerMessage)}</div>
      </div>

      <div style="margin-top:12px;padding:14px 16px;border-left:3px solid #b18a2f;background:#fdf9ef;border-radius:0 6px 6px 0;">
        <div style="font-size:12px;color:#556;margin-bottom:4px;">Bot replied</div>
        <div style="white-space:pre-wrap;font-size:14px;color:#111;">${esc(input.botReply)}</div>
      </div>

      <p style="margin:24px 0 0 0;">
        <a href="${esc(deepLink)}" style="display:inline-block;background:#024628;color:#fbf3d4;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px;">Open conversation</a>
      </p>

      <p style="margin:20px 0 0 0;font-size:12px;color:#7a6a3a;">
        You will not get another email for this conversation until it is resolved.
      </p>
    </div>
  </body>
</html>`;

  const text =
    `Cadieux WhatsApp — handoff needed\n` +
    `Reason: ${reasonLabel}\n` +
    `Phone: ${input.phone}\n` +
    `When: ${input.timestampIso}\n\n` +
    `Customer said:\n${input.customerMessage}\n\n` +
    `Bot replied:\n${input.botReply}\n\n` +
    `Open conversation: ${deepLink}\n`;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[handoff-email] resend send failed", res.status, body);
      return { ok: false, error: `HTTP ${res.status}`, recipient: to };
    }
    return { ok: true, recipient: to };
  } catch (e) {
    console.error("[handoff-email] send threw:", (e as Error).message);
    return { ok: false, error: (e as Error).message, recipient: to };
  }
}
