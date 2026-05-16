// Email templates for subscription expiry reminders.
//
// Five windows, each with its own copy:
//   7d_before    — "Your Cadieux subscription ends in 7 days"
//   3d_before    — "3 days left on your Cadieux subscription"
//   1d_before    — "Last delivery tomorrow"
//   expiry_day   — "Your subscription ends today"
//   3d_after     — "We miss you — renew your Cadieux subscription"
//
// Each function returns { subject, html, text }. Brand styling:
//   - dark green #2F6A3A (Cadieux primary)
//   - gold #C9A96E (accent)
//   - cream #FBF3D4 (paper)
//   - charcoal #0a0a0a (text on cream)

export type ReminderWindow =
  | "7d_before"
  | "3d_before"
  | "1d_before"
  | "expiry_day"
  | "3d_after";

export interface ReminderInput {
  firstName: string;       // e.g. "Arjun" — falls back to "there" if empty
  planName: string;        // e.g. "Multigrain Sourdough (12 weeks)"
  endDate: string;         // formatted IST date string, e.g. "Mon, 23 Jun 2026"
}

export interface ReminderEmail {
  subject: string;
  html: string;
  text: string;
}

const GREEN = "#2F6A3A";
const GOLD = "#C9A96E";
const CREAM = "#FBF3D4";
const INK = "#0a0a0a";
const MUTED = "#5b5b5b";

const ACCOUNT_URL = "https://www.cadieux.in/account/subscription";
const SUPPORT_EMAIL = "support@cadieux.in";

function safeName(n: string): string {
  const t = (n || "").trim();
  if (!t) return "there";
  return t.split(/\s+/)[0];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shell(args: {
  preheader: string;
  heading: string;
  intro: string;
  body: string;
  ctaLabel: string;
}): string {
  const { preheader, heading, intro, body, ctaLabel } = args;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};font-family:Georgia,'Times New Roman',serif;color:${INK};">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid rgba(0,0,0,0.06);">
        <tr><td style="background:${GREEN};padding:28px 32px;text-align:center;">
          <div style="font-family:Georgia,serif;font-size:28px;letter-spacing:0.18em;color:${CREAM};text-transform:uppercase;">Cadieux</div>
          <div style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.35em;color:${GOLD};text-transform:uppercase;margin-top:6px;">Slow-baked in Visakhapatnam</div>
        </td></tr>
        <tr><td style="padding:36px 32px 8px 32px;">
          <h1 style="margin:0 0 14px 0;font-family:Georgia,serif;font-size:22px;font-weight:400;color:${INK};line-height:1.3;">${escapeHtml(heading)}</h1>
          <p style="margin:0 0 18px 0;font-size:15px;line-height:1.6;color:${INK};">${intro}</p>
          <div style="margin:18px 0 22px 0;font-size:15px;line-height:1.7;color:${INK};">${body}</div>
          <div style="margin:28px 0 8px 0;">
            <a href="${ACCOUNT_URL}" style="display:inline-block;background:${GREEN};color:${CREAM};text-decoration:none;padding:14px 28px;font-family:Georgia,serif;font-size:14px;letter-spacing:0.18em;text-transform:uppercase;border:1px solid ${GREEN};">${escapeHtml(ctaLabel)}</a>
          </div>
        </td></tr>
        <tr><td style="padding:8px 32px 36px 32px;">
          <p style="margin:24px 0 0 0;font-size:13px;line-height:1.6;color:${MUTED};">Thank you for choosing Cadieux.<br/>— The bakers</p>
        </td></tr>
        <tr><td style="background:${INK};padding:22px 32px;text-align:center;">
          <div style="font-family:Georgia,serif;font-size:11px;letter-spacing:0.25em;color:${GOLD};text-transform:uppercase;">Cadieux Bakery</div>
          <div style="font-size:12px;color:rgba(251,243,212,0.65);margin-top:8px;line-height:1.6;">
            Questions? Write to us at <a href="mailto:${SUPPORT_EMAIL}" style="color:${GOLD};text-decoration:none;">${SUPPORT_EMAIL}</a><br/>
            Manage your subscription at <a href="${ACCOUNT_URL}" style="color:${GOLD};text-decoration:none;">cadieux.in/account/subscription</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function plainShell(args: {
  heading: string;
  intro: string;
  body: string;
  ctaLabel: string;
}): string {
  const { heading, intro, body, ctaLabel } = args;
  return [
    "CADIEUX",
    "Slow-baked in Visakhapatnam",
    "",
    heading,
    "",
    intro,
    "",
    body,
    "",
    `${ctaLabel}: ${ACCOUNT_URL}`,
    "",
    "Thank you for choosing Cadieux.",
    "— The bakers",
    "",
    "—",
    `Questions? ${SUPPORT_EMAIL}`,
    `Manage your subscription: ${ACCOUNT_URL}`,
  ].join("\n");
}

export function reminder7dBefore(i: ReminderInput): ReminderEmail {
  const name = safeName(i.firstName);
  const subject = `Your Cadieux subscription ends in 7 days`;
  const heading = `Hi ${name}, your subscription ends in a week.`;
  const intro = `Your <strong>${escapeHtml(i.planName)}</strong> plan is scheduled to end on <strong>${escapeHtml(i.endDate)}</strong>.`;
  const body = `That's just 7 days away. To keep the loaves arriving uninterrupted, renew your subscription before it lapses — it only takes a minute.`;
  const ctaLabel = "Renew subscription";
  return {
    subject,
    html: shell({
      preheader: `7 days left on your ${i.planName} plan.`,
      heading, intro, body, ctaLabel,
    }),
    text: plainShell({
      heading,
      intro: `Your ${i.planName} plan ends on ${i.endDate}.`,
      body: `That's just 7 days away. Renew now to keep your loaves arriving uninterrupted.`,
      ctaLabel,
    }),
  };
}

export function reminder3dBefore(i: ReminderInput): ReminderEmail {
  const name = safeName(i.firstName);
  const subject = `3 days left on your Cadieux subscription`;
  const heading = `Hi ${name}, only 3 days to go.`;
  const intro = `Your <strong>${escapeHtml(i.planName)}</strong> plan ends on <strong>${escapeHtml(i.endDate)}</strong>.`;
  const body = `Renew now and we'll line up the next batch of deliveries with no break. Bread waits for no one — and neither does our oven schedule.`;
  const ctaLabel = "Renew now";
  return {
    subject,
    html: shell({
      preheader: `3 days left on your ${i.planName} plan.`,
      heading, intro, body, ctaLabel,
    }),
    text: plainShell({
      heading,
      intro: `Your ${i.planName} plan ends on ${i.endDate}.`,
      body: `Only 3 days left. Renew to keep deliveries flowing without a gap.`,
      ctaLabel,
    }),
  };
}

export function reminder1dBefore(i: ReminderInput): ReminderEmail {
  const name = safeName(i.firstName);
  const subject = `Last delivery tomorrow — renew your Cadieux subscription`;
  const heading = `Hi ${name}, tomorrow is your final delivery.`;
  const intro = `Your <strong>${escapeHtml(i.planName)}</strong> plan ends on <strong>${escapeHtml(i.endDate)}</strong>.`;
  const body = `If you'd like the next loaf to arrive on schedule, renew today. We'll pick up exactly where this plan leaves off.`;
  const ctaLabel = "Renew today";
  return {
    subject,
    html: shell({
      preheader: `Your last delivery is tomorrow — renew to continue.`,
      heading, intro, body, ctaLabel,
    }),
    text: plainShell({
      heading,
      intro: `Your ${i.planName} plan ends on ${i.endDate}.`,
      body: `Tomorrow is your final scheduled delivery. Renew today to continue without a gap.`,
      ctaLabel,
    }),
  };
}

export function reminderExpiryDay(i: ReminderInput): ReminderEmail {
  const name = safeName(i.firstName);
  const subject = `Your Cadieux subscription ends today`;
  const heading = `Hi ${name}, your subscription ends today.`;
  const intro = `Today is the final delivery of your <strong>${escapeHtml(i.planName)}</strong> plan.`;
  const body = `We've loved baking for you. If you'd like to keep the rhythm going, renew now — your next plan can start as early as tomorrow.`;
  const ctaLabel = "Continue with Cadieux";
  return {
    subject,
    html: shell({
      preheader: `Today is your final scheduled delivery.`,
      heading, intro, body, ctaLabel,
    }),
    text: plainShell({
      heading,
      intro: `Today is the final delivery of your ${i.planName} plan.`,
      body: `We've loved baking for you. Renew now to keep going — your next plan can start as early as tomorrow.`,
      ctaLabel,
    }),
  };
}

export function reminder3dAfter(i: ReminderInput): ReminderEmail {
  const name = safeName(i.firstName);
  const subject = `We miss you — renew your Cadieux subscription`;
  const heading = `Hi ${name}, your subscription wrapped up a few days ago.`;
  const intro = `Your <strong>${escapeHtml(i.planName)}</strong> plan ended on <strong>${escapeHtml(i.endDate)}</strong>.`;
  const body = `The oven is still warm. Pick up where you left off — same loaf, same slot, or try something new from our range.`;
  const ctaLabel = "Start a new plan";
  return {
    subject,
    html: shell({
      preheader: `It's been 3 days — your oven is still warm.`,
      heading, intro, body, ctaLabel,
    }),
    text: plainShell({
      heading,
      intro: `Your ${i.planName} plan ended on ${i.endDate}.`,
      body: `The oven is still warm. Start a new plan and pick up where you left off.`,
      ctaLabel,
    }),
  };
}

export function buildReminder(
  window: ReminderWindow,
  input: ReminderInput,
): ReminderEmail {
  switch (window) {
    case "7d_before":  return reminder7dBefore(input);
    case "3d_before":  return reminder3dBefore(input);
    case "1d_before":  return reminder1dBefore(input);
    case "expiry_day": return reminderExpiryDay(input);
    case "3d_after":   return reminder3dAfter(input);
  }
}
