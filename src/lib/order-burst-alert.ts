// Burst alert: tell the owner when one phone number is creating orders faster
// than a customer plausibly could.
//
// WHY THIS EXISTS AND WHY IT IS NOT REDUNDANT WITH THE RATE LIMITER
// On 13 Sep a probe created 34 orders between 01:16 and 03:58 IST. Sunny found
// it at 07:30. The rate limiter shipped that morning stops the 6th create; it
// does not wake anyone up. Validation is also not the last line — two of the
// fake customer rows carried phone numbers that pass isValidIndianMobile, so a
// probe willing to use well-formed numbers walks straight through the format
// gate. What it cannot hide is the RATE, and that is what this watches.
//
// TRIGGER: COUNT-BASED, NOT DENIAL-BASED
// The obvious design is "email when the rate limiter rejects someone". It is
// wrong twice over:
//   1. orderPhoneRateLimit caps a phone at 5 creates/hour, so "more than 5
//      successful creates" is unreachable by construction and an alert on >5
//      would never fire at all.
//   2. allowedOrFailOpen fails OPEN. During an Upstash outage the limiter
//      rejects nobody, so a denial-triggered alert goes silent in exactly the
//      window where the protection is also gone — the one time we most need
//      to hear about a burst.
// So this counts committed rows instead. It fires at BURST_THRESHOLD creates
// in the trailing hour, which is the limiter's own cap: the alert lands on the
// create that exhausts the quota, one create before the 429s begin, and it
// still fires normally when the limiter is failing open.
//
// DEDUP: one email per (phone, clock hour), enforced by the UNIQUE constraint
// on public.order_burst_alerts. Without it every create past the threshold
// would send its own email and the alert would be indistinguishable from the
// attack. Claim-before-send, same discipline as order_notifications_sent: a
// row at 'pending' is a visible record of an attempt, not silence.
//
// A NOTE ON WHAT THIS DOES NOT CATCH: a probe that rotates phone numbers
// defeats a per-phone alert entirely. The IP axis would see it, but getClientIP
// trusts the first x-forwarded-for entry, which the caller supplies. Per-phone
// is the axis that actually binds today; this is a tripwire, not a wall.

import { createClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";

import { ALERT_EMAILS, FROM_EMAIL } from "@/lib/alert-emails";
import { isValidIndianMobile } from "@/lib/phone-cookie";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 8000;

/** Postgres unique_violation — someone else already alerted for this hour. */
const PG_UNIQUE_VIOLATION = "23505";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Creates in the trailing hour that make a number worth an email.
 *
 * Equal to orderPhoneRateLimit's cap on purpose — see the header. Five is also
 * comfortably above real behaviour: the busiest genuine number on 13 Sep, a
 * day with 34 real orders, placed 2.
 */
const BURST_THRESHOLD = 5;

/** Never list more than this many rows in the email body. */
const MAX_LISTED = 12;

type RecentOrder = {
  id: string;
  order_number: string | null;
  total_amount: number | string | null;
  status: string | null;
  payment_status: string | null;
  created_at: string;
};

type RecentSub = {
  id: string;
  total_amount: number | string | null;
  status: string | null;
  payment_status: string | null;
  created_at: string;
};

// ── helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Bare ten digits, dropping an optional 91/+91.
 *
 * NOT normalizePhone(): that returns E.164, and the same human would then
 * occupy two dedup buckets depending on which create path saw them. The local
 * ten digits are also the form every genuine row in `customers` is stored in.
 */
function toLocal10(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 12 && digits.startsWith("91")
    ? digits.slice(2)
    : digits;
}

/** Start of the current UTC hour — the dedup bucket. */
function hourBucket(now: number): string {
  return new Date(Math.floor(now / HOUR_MS) * HOUR_MS).toISOString();
}

function money(v: number | string | null): string {
  const n = typeof v === "string" ? Number(v) : v;
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** "13 Sep 14:46 IST" — the reader is in India and is scanning for a pattern. */
function istTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    }) + " IST"
  );
}

// ── message ─────────────────────────────────────────────────────────────────

function buildMessage(
  phone: string,
  total: number,
  orders: RecentOrder[],
  subs: RecentSub[],
  names: string[],
): { subject: string; html: string; text: string } {
  const subject = `ALERT: ${total} creates in 1 hour from ${phone}`;

  const lines: string[] = [];
  for (const o of orders.slice(0, MAX_LISTED)) {
    lines.push(
      `order ${o.order_number ?? o.id.slice(0, 8).toUpperCase()} — Rs ${money(o.total_amount)} — ${o.status ?? "?"}/${o.payment_status ?? "?"} — ${istTime(o.created_at)}`,
    );
  }
  for (const s of subs.slice(0, MAX_LISTED)) {
    lines.push(
      `subscription ${s.id.slice(0, 8).toUpperCase()} — Rs ${money(s.total_amount)} — ${s.status ?? "?"}/${s.payment_status ?? "?"} — ${istTime(s.created_at)}`,
    );
  }
  const hidden = orders.length + subs.length - lines.length;
  if (hidden > 0) lines.push(`… and ${hidden} more`);

  const header = [
    `Phone: ${phone}`,
    `Customer name(s) on file: ${names.length ? names.join(", ") : "—"}`,
    `Creates in the last hour: ${total} (threshold ${BURST_THRESHOLD})`,
  ];

  const text = [
    `${total} orders/subscriptions were created from ${phone} in the last hour.`,
    "",
    ...header,
    "",
    "Recent:",
    ...lines.map((l) => `  - ${l}`),
    "",
    "This is the only email you will get for this number this hour.",
    "If this is not a real customer, cancel the rows and block the number.",
  ].join("\n");

  const html =
    `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.5;max-width:560px;margin:0 auto;padding:24px;">` +
    `<div style="border-top:3px solid #b00020;padding-top:16px;">` +
    `<h2 style="margin:0 0 4px;font-size:18px;">${total} creates in one hour from ${escapeHtml(phone)}</h2>` +
    `<p style="margin:0 0 16px;color:#666;font-size:14px;">Threshold is ${BURST_THRESHOLD}. One email per number per hour.</p>` +
    `<table style="border-collapse:collapse;width:100%;font-size:14px;">` +
    header
      .map((h) => {
        const [k, ...rest] = h.split(": ");
        return (
          `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;white-space:nowrap;">${escapeHtml(k)}</td>` +
          `<td style="padding:4px 0;">${escapeHtml(rest.join(": "))}</td></tr>`
        );
      })
      .join("") +
    `</table>` +
    `<p style="margin:16px 0 4px;color:#666;font-size:14px;">Recent</p>` +
    `<table style="border-collapse:collapse;width:100%;font-size:13px;">` +
    lines
      .map(
        (l) =>
          `<tr><td style="padding:4px 0;border-bottom:1px solid #eee;">${escapeHtml(l)}</td></tr>`,
      )
      .join("") +
    `</table>` +
    `<p style="margin:16px 0 0;font-size:14px;">If this is not a real customer, cancel the rows and block the number.</p>` +
    `</div></body></html>`;

  return { subject, html, text };
}

type SendResult =
  | { ok: true; resendId: string | null }
  | { ok: false; error: string };

/**
 * POST to Resend. Never throws.
 *
 * REST rather than the SDK for the same reason order-notification.ts uses it:
 * the SDK's send options carry no `signal`, so a hung connection would sit
 * inside waitUntil until the platform killed the invocation, leaving the row
 * at 'pending' with no error recorded.
 */
async function sendEmail(msg: {
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, error: "RESEND_API_KEY is not configured" };
  }
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: ALERT_EMAILS,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status} ${detail}`.trim() };
    }
    const data = (await res.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, resendId: data?.id ?? null };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? `${e.name}: ${e.message}` : "Unknown send error",
    };
  }
}

// ── core ────────────────────────────────────────────────────────────────────

async function runBurstCheck(rawPhone: string): Promise<void> {
  const phone = toLocal10(rawPhone);
  if (!isValidIndianMobile(phone)) return;

  // Resolve every customer row carrying this number, not just the one the
  // caller used. save_customer looks rows up by exact string while
  // isValidIndianMobile also accepts +91…, so one human can hold more than one
  // row — and counting per row instead of per number would let a burst hide by
  // alternating between them.
  const { data: custRows, error: custErr } = await supabaseAdmin
    .from("customers")
    .select("id, full_name")
    .in("phone", [phone, `91${phone}`, `+91${phone}`]);

  if (custErr) {
    console.error("[order-burst-alert] customer lookup failed:", custErr.message);
    return;
  }
  const ids = (custRows ?? []).map((c) => (c as { id: string }).id);
  if (ids.length === 0) return;

  const cutoff = new Date(Date.now() - HOUR_MS).toISOString();

  // Rows, not counts: the same read produces both the trigger and the body of
  // the email, and an alert that says only "6 orders" sends the reader to the
  // admin panel to find out which.
  const [orderRes, subRes] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select("id, order_number, total_amount, status, payment_status, created_at")
      .in("customer_id", ids)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(50),
    supabaseAdmin
      .from("subscriptions")
      .select("id, total_amount, status, payment_status, created_at")
      .in("customer_id", ids)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (orderRes.error || subRes.error) {
    console.error(
      "[order-burst-alert] recent-rows read failed:",
      orderRes.error?.message ?? subRes.error?.message,
    );
    return;
  }

  const orders = (orderRes.data ?? []) as unknown as RecentOrder[];
  const subs = (subRes.data ?? []) as unknown as RecentSub[];
  const total = orders.length + subs.length;
  if (total < BURST_THRESHOLD) return;

  const names = (custRows ?? [])
    .map((c) => (c as { full_name: string | null }).full_name?.trim())
    .filter((n): n is string => Boolean(n));

  const { subject, html, text } = buildMessage(phone, total, orders, subs, names);

  // Claim the (phone, hour) slot BEFORE sending. The UNIQUE constraint is what
  // turns a 30-order burst into one email; losing the race is the normal case
  // here, not an error.
  const { data: claim, error: claimErr } = await supabaseAdmin
    .from("order_burst_alerts")
    .insert({
      phone,
      hour_bucket: hourBucket(Date.now()),
      create_count: total,
      status: "pending",
      to_email: ALERT_EMAILS.join(","),
      subject,
      attempts: 1,
    })
    .select("id")
    .single();

  if (claimErr) {
    if (claimErr.code === PG_UNIQUE_VIOLATION) return; // already alerted
    console.error("[order-burst-alert] could not claim slot:", claimErr.message);
    return;
  }
  const rowId = (claim as { id: string }).id;

  // Loud regardless of whether the email lands: this is the line that survives
  // a Resend outage, and Vercel's runtime logs are searchable.
  console.error(
    `[order-burst-alert] ${total} creates in 1h from ${phone} (threshold ${BURST_THRESHOLD})`,
  );

  const sent = await sendEmail({ subject, html, text });
  const patch = sent.ok
    ? { status: "sent", resend_id: sent.resendId, updated_at: new Date().toISOString() }
    : { status: "failed", error: sent.error.slice(0, 500), updated_at: new Date().toISOString() };

  if (!sent.ok) {
    console.error(`[order-burst-alert] send FAILED for ${phone}: ${sent.error}`);
  }

  const { error: updErr } = await supabaseAdmin
    .from("order_burst_alerts")
    .update(patch)
    .eq("id", rowId);
  if (updErr) {
    console.error(
      `[order-burst-alert] ${phone}: send recorded as ${patch.status} but row update failed:`,
      updErr.message,
    );
  }
}

// ── entry point ─────────────────────────────────────────────────────────────

/**
 * Fire-and-forget a burst check for `phone`. Never throws, never rejects and
 * never delays the caller — call it after a successful create and return your
 * response.
 *
 * Call it AFTER the insert, not before: a create that is going to 400 on price
 * validation is an attempt, not an order, and counting attempts would make the
 * threshold mean something different on each path.
 *
 * waitUntil for the same reason as queueOrderNotification — Vercel may freeze
 * the invocation the moment the response is returned, which would kill a bare
 * floating promise mid-send. Outside a Vercel request context it is a no-op.
 */
export function queueBurstAlert(phone: string | null | undefined): void {
  try {
    if (!phone) return;
    const task = runBurstCheck(phone).catch((e) => {
      // An unhandled rejection inside waitUntil can take down the invocation,
      // which WOULD affect the customer. Nothing above should reject.
      console.error("[order-burst-alert] threw:", e);
    });
    waitUntil(task);
  } catch (e) {
    console.error("[order-burst-alert] queue failed:", e);
  }
}
