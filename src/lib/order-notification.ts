// Admin new-order email alert.
//
// One entry point — queueOrderNotification(orderId, event) — called from every
// route that either creates a payable order or moves one to paid. It returns
// void and can never throw: checkout correctness does not depend on an email.
//
// TWO EVENTS PER ORDER, AT MOST:
//   'created' — COD / pay-at-pickup, fired at insert time.
//   'paid'    — money actually arrived on a previously unpaid order.
// Online orders get ONLY 'paid'; they are inserted as razorpay/created and
// roughly a quarter of those attempts never complete, so emailing at insert
// would mostly announce orders that never happen.
// A COD order that later pays online legitimately produces BOTH. Suppressing
// the second would send someone to collect cash for an already-paid order —
// an operational error, not inbox noise.
//
// WHY THE CALLER PASSES ONLY AN ID: the order is re-read from the database
// here. Callers hold partial `.select()` projections that differ per route, and
// the mobile/web/admin paths disagree about which fields they carry. Re-reading
// means the email body is identical no matter who triggered it, and it cannot
// render a value that was never committed.
//
// COVERAGE: this is wired into the 7 routes that exist today (3 create, 4 pay).
// It is NOT a structural guarantee — a future route, a raw SQL insert or a
// Supabase dashboard edit bypasses it. The structural version is an AFTER
// INSERT / AFTER UPDATE trigger on public.orders, which was considered and
// rejected: it needs the pg_net extension installed in production, and pg_net's
// fire-and-forget-with-no-retry semantics are a poor fit for something whose
// failures we want recorded. If that trade is ever revisited, the trigger can
// call this module's logic through an HTTP route and the dedup table below
// works unchanged — that is why the send-once guard lives in Postgres and not
// in this file.

import { createClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";

import { formatOrderNumber } from "@/lib/order-number";

export type OrderNotificationEvent = "created" | "paid";

// Service-role client. Deliberately constructed here rather than imported from
// @/lib/admin-auth: that module also pulls in the admin-session HMAC helpers,
// which have no business being in the public checkout bundle.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const RESEND_ENDPOINT = "https://api.resend.com/emails";

const TO_EMAIL = process.env.ORDER_ALERT_EMAIL || "admin@cadieux.in";
const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || "Cadieux <hello@cadieux.in>";

// Resend has no server-side deadline of its own. Without this a hung
// connection would sit inside waitUntil until the platform kills the whole
// invocation, and the failure would never be recorded.
const SEND_TIMEOUT_MS = 8000;

// Postgres unique_violation. Someone else already owns this (order, event).
const PG_UNIQUE_VIOLATION = "23505";

type OrderItem = {
  name?: unknown;
  qty?: unknown;
  price_inr?: unknown;
  line_total?: unknown;
};

type OrderRow = {
  id: string;
  order_number: string | null;
  total_amount: number | string | null;
  delivery_fee: number | string | null;
  items: unknown;
  delivery_address: string | null;
  delivery_date: string | null;
  delivery_slot: string | null;
  payment_method: string | null;
  payment_status: string | null;
  fulfillment_type: string | null;
  pickup_location_id: string | null;
  created_at: string;
  customers: { full_name: string | null; phone: string | null } | null;
};

// ── formatting ──────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Rupees with no decimals when whole. The subject line is scanned on a phone
// lock screen, so "Rs 448" beats "Rs 448.00".
function rupees(v: number | string | null): string {
  const n = typeof v === "string" ? Number(v) : v;
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// "2026-09-10" -> "Wed, 10 Sep 2026". Date-only column, so it is parsed as UTC
// and printed in UTC: shifting it into IST would move it a day for anything
// before 05:30 and misreport the delivery date.
function formatDeliveryDate(iso: string | null): string {
  if (!iso) return "Not set";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = dt.toLocaleDateString("en-IN", {
    weekday: "short",
    timeZone: "UTC",
  });
  const month = dt.toLocaleDateString("en-IN", {
    month: "short",
    timeZone: "UTC",
  });
  return `${weekday}, ${dt.getUTCDate()} ${month} ${dt.getUTCFullYear()}`;
}

function parseItems(raw: unknown): { label: string; amount: string }[] {
  if (!Array.isArray(raw)) return [];
  return (raw as OrderItem[]).map((it) => {
    const name = typeof it?.name === "string" ? it.name : "Item";
    const qty = Number(it?.qty);
    const line = it?.line_total ?? it?.price_inr;
    return {
      label: `${name} x${Number.isFinite(qty) ? qty : 1}`,
      amount: `Rs ${rupees(typeof line === "number" || typeof line === "string" ? line : null)}`,
    };
  });
}

function paymentLine(order: OrderRow): string {
  const method = (order.payment_method || "").toLowerCase();
  const label = method === "cod" ? "Cash on delivery" : method === "razorpay" ? "Online (Razorpay)" : method || "Unknown";
  const paid = order.payment_status === "paid";
  return `${label} — ${paid ? "PAID" : "UNPAID"}`;
}

// ── message ─────────────────────────────────────────────────────────────────

function buildMessage(
  order: OrderRow,
  event: OrderNotificationEvent,
  isFirstEmailForOrder: boolean,
  pickupLabel: string | null,
): { subject: string; html: string; text: string } {
  const olf = formatOrderNumber(order);
  const name = order.customers?.full_name?.trim() || "Unknown customer";
  const phone = order.customers?.phone?.trim() || "—";
  const total = rupees(order.total_amount);
  const isPickup = (order.fulfillment_type || "").toLowerCase() === "pickup";

  // A 'paid' event that is NOT the order's first email is a COD order that has
  // since been paid online. That is a different instruction to the person
  // reading it — "do not collect cash" — so it must not look like a new order.
  const headline =
    event === "paid" && !isFirstEmailForOrder ? "Payment received" : "New order";

  // PICKUP goes in the subject because the failure it prevents is dispatching a
  // rider for an order nobody is delivering.
  const subject = `${headline} ${olf}${isPickup ? " - PICKUP" : ""} - ${name} - Rs ${total}`;

  const items = parseItems(order.items);
  const fee = Number(order.delivery_fee);
  const rows: [string, string][] = [
    ["Order", olf],
    ["Customer", name],
    ["Phone", phone],
    ["Fulfilment", isPickup ? "PICKUP — customer collects" : "Delivery"],
    [isPickup ? "Pickup point" : "Address", (isPickup ? pickupLabel : order.delivery_address) || "—"],
    ["Date", formatDeliveryDate(order.delivery_date)],
    ["Slot", order.delivery_slot || "Not set"],
    ["Payment", paymentLine(order)],
    ["Total", `Rs ${total}${Number.isFinite(fee) && fee > 0 ? ` (incl. Rs ${rupees(fee)} delivery)` : ""}`],
  ];

  const text = [
    `${headline}: ${olf}`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "Items:",
    ...(items.length
      ? items.map((i) => `  - ${i.label}  ${i.amount}`)
      : ["  (none recorded)"]),
  ].join("\n");

  const html =
    `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.5;max-width:560px;margin:0 auto;padding:24px;">` +
    `<div style="border-top:3px solid #024628;padding-top:16px;">` +
    `<h2 style="margin:0 0 4px;font-size:18px;">${escapeHtml(headline)} ${escapeHtml(olf)}</h2>` +
    (isPickup
      ? `<p style="margin:0 0 16px;font-weight:bold;color:#8a4b00;">PICKUP — do not dispatch a rider.</p>`
      : "") +
    `<table style="border-collapse:collapse;width:100%;font-size:14px;">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;white-space:nowrap;">${escapeHtml(k)}</td>` +
          `<td style="padding:4px 0;">${escapeHtml(v)}</td></tr>`,
      )
      .join("") +
    `</table>` +
    `<p style="margin:16px 0 4px;color:#666;font-size:14px;">Items</p>` +
    `<table style="border-collapse:collapse;width:100%;font-size:14px;">` +
    (items.length
      ? items
          .map(
            (i) =>
              `<tr><td style="padding:4px 12px 4px 0;">${escapeHtml(i.label)}</td>` +
              `<td style="padding:4px 0;text-align:right;white-space:nowrap;">${escapeHtml(i.amount)}</td></tr>`,
          )
          .join("")
      : `<tr><td style="padding:4px 0;color:#666;">(none recorded)</td></tr>`) +
    `</table></div></body></html>`;

  return { subject, html, text };
}

// ── shared steps ────────────────────────────────────────────────────────────
// prepareMessage and sendEmail are split out of runNotification so the retry
// sweeper at the bottom of this file can rebuild and re-send a row that has
// ALREADY been claimed. It cannot reuse runNotification: that function claims
// by INSERT, so a retry would take a 23505 against its own row and give up —
// which is exactly why, before the sweeper existed, a failed send was lost
// permanently.

type PreparedMessage =
  | { ok: true; subject: string; html: string; text: string }
  | { ok: false; reason: string };

/** Re-read the order from committed state and render the email for it. */
async function prepareMessage(
  orderId: string,
  event: OrderNotificationEvent,
): Promise<PreparedMessage> {
  const { data, error: readErr } = await supabaseAdmin
    .from("orders")
    .select(
      "id, order_number, total_amount, delivery_fee, items, delivery_address, delivery_date, delivery_slot, payment_method, payment_status, fulfillment_type, pickup_location_id, created_at, customers(full_name, phone)",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (readErr || !data) {
    return {
      ok: false,
      reason: `order re-read failed: ${readErr?.message ?? "not found"}`,
    };
  }
  const order = data as unknown as OrderRow;

  // Re-assert the trigger condition against committed state rather than
  // trusting the caller. A route that fires 'paid' on a row whose UPDATE was
  // rolled back, or 'created' on an online order, is a bug we should not turn
  // into an email.
  if (event === "paid" && order.payment_status !== "paid") {
    return {
      ok: false,
      reason: `order is not paid (payment_status=${order.payment_status ?? "null"})`,
    };
  }

  // Has this order already produced an email for the OTHER event? Decides
  // "New order" vs "Payment received". Only a different event counts, so this
  // stays correct on a retry, where the row being retried is itself present.
  const { data: priorRows } = await supabaseAdmin
    .from("order_notifications_sent")
    .select("event")
    .eq("order_id", orderId);
  const isFirstEmailForOrder = !(priorRows ?? []).some(
    (r) => (r as { event: string }).event !== event,
  );

  let pickupLabel: string | null = null;
  if (
    (order.fulfillment_type || "").toLowerCase() === "pickup" &&
    order.pickup_location_id
  ) {
    // No FK exists between orders.pickup_location_id and pickup_locations.id,
    // so this cannot be a join in the select above.
    const { data: loc } = await supabaseAdmin
      .from("pickup_locations")
      .select("name, area, address")
      .eq("id", order.pickup_location_id)
      .maybeSingle();
    if (loc) {
      const l = loc as { name: string | null; area: string | null; address: string | null };
      pickupLabel = [l.name, l.area, l.address].filter(Boolean).join(", ") || null;
    }
  }

  return {
    ok: true,
    ...buildMessage(order, event, isFirstEmailForOrder, pickupLabel),
  };
}

type SendResult =
  | { ok: true; resendId: string | null }
  | { ok: false; error: string };

/**
 * POST the message to Resend. Never throws — every failure comes back as a
 * string the caller can persist.
 *
 * Resend's REST endpoint rather than its SDK: the SDK's send options have no
 * `signal`, so an SDK call cannot be cancelled and a hung connection would sit
 * inside waitUntil until the platform killed the invocation — with the row
 * stuck at 'pending' and no error recorded. fetch + an abort signal gives a
 * real deadline and a loggable failure. Same endpoint and payload shape as
 * supabase/functions/_shared/handoff-email.ts.
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
        to: TO_EMAIL,
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
    const sendData = (await res.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, resendId: sendData?.id ?? null };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? `${e.name}: ${e.message}` : "Unknown send error",
    };
  }
}

// ── core ────────────────────────────────────────────────────────────────────

async function runNotification(
  orderId: string,
  event: OrderNotificationEvent,
): Promise<void> {
  const prepared = await prepareMessage(orderId, event);
  if (!prepared.ok) {
    console.warn(
      `[order-notification] ${event} ${orderId}: skipped — ${prepared.reason}`,
    );
    return;
  }
  const { subject, html, text } = prepared;

  // Claim the (order, event) slot BEFORE sending. Two reasons, in order of
  // importance:
  //   1. UNIQUE(order_id, event) makes this the send-once guard. verify-payment
  //      and razorpay-webhook both reach here for the same payment; the loser
  //      gets 23505 and stops. Doing this after the send would double-email.
  //   2. A row that exists in 'pending' is a visible record of an attempt. If
  //      the send then hangs and the invocation dies, the failure is a row
  //      someone can query — not silence.
  const { data: claim, error: claimErr } = await supabaseAdmin
    .from("order_notifications_sent")
    .insert({
      order_id: orderId,
      event,
      status: "pending",
      to_email: TO_EMAIL,
      subject,
      attempts: 1,
    })
    .select("id")
    .single();

  if (claimErr) {
    if (claimErr.code === PG_UNIQUE_VIOLATION) return; // already handled
    console.error(
      `[order-notification] ${event} ${orderId}: could not claim slot:`,
      claimErr.message,
    );
    return;
  }
  const rowId = (claim as { id: string }).id;

  const markFailed = async (reason: string) => {
    console.error(`[order-notification] ${event} ${orderId} FAILED: ${reason}`);
    await supabaseAdmin
      .from("order_notifications_sent")
      .update({ status: "failed", error: reason.slice(0, 500), updated_at: new Date().toISOString() })
      .eq("id", rowId);
  };

  const sent = await sendEmail({ subject, html, text });
  if (!sent.ok) {
    // Recorded, not lost: sweepOrderNotifications() below picks this row up
    // and retries it, and the daily cron runs that sweep unattended.
    await markFailed(sent.error);
    return;
  }
  const resendId = sent.resendId;

  const { error: updErr } = await supabaseAdmin
    .from("order_notifications_sent")
    .update({ status: "sent", resend_id: resendId, updated_at: new Date().toISOString() })
    .eq("id", rowId);
  if (updErr) {
    // The email DID go out; only the bookkeeping failed. The row stays at
    // 'pending', so the sweeper will eventually re-send it and Sunny gets the
    // alert twice. That is the deliberate trade: this needs BOTH a successful
    // send and a failed update in the same call, and a duplicate alert costs
    // far less than a missed order.
    console.error(
      `[order-notification] ${event} ${orderId}: sent (${resendId}) but status update failed:`,
      updErr.message,
    );
  }
}

// ── entry point ─────────────────────────────────────────────────────────────

/**
 * Fire-and-forget an admin alert for `orderId`. Never throws, never rejects,
 * and never delays the caller — call it and return your response.
 *
 * Vercel may freeze a serverless invocation the moment its response is
 * returned, which would kill a bare floating promise mid-send. waitUntil keeps
 * the invocation alive for the send WITHOUT holding up the response, so an
 * email is not silently lost to a lambda that shut down early.
 *
 * waitUntil is imported statically and called synchronously on purpose: a
 * dynamic import would resolve a microtask later, by which point the response
 * may already have been returned and the invocation frozen — registering the
 * task too late to protect it. Outside a Vercel request context (local dev,
 * tests) it is a no-op and does not throw, so the promise simply runs to
 * completion on its own.
 */
export function queueOrderNotification(
  orderId: string,
  event: OrderNotificationEvent,
): void {
  try {
    if (!orderId) return;
    const task = runNotification(orderId, event).catch((e) => {
      // Last line of defence. Nothing above should reject, but an unhandled
      // rejection inside waitUntil can take down the invocation, which WOULD
      // affect the customer.
      console.error(`[order-notification] ${event} ${orderId} threw:`, e);
    });
    waitUntil(task);
  } catch (e) {
    console.error(`[order-notification] ${event} ${orderId} queue failed:`, e);
  }
}

// ── retry sweeper ───────────────────────────────────────────────────────────
//
// Without this, a transient Resend failure silently eats an order alert: the
// row sits at 'failed' forever, the unique index blocks any fresh attempt, and
// the only person who would notice is someone querying a table nobody queries.
//
// Runs from two places, both of which call this same function:
//   • GET /api/admin/order-notifications/retry — admin-session gated, so Sunny
//     can trigger it from the browser he is already logged into.
//   • the reports phase of /api/cron/daily-housekeeping — so it self-heals
//     daily without anyone remembering.

/** Give up after this many attempts. A permanently bad row must not churn. */
export const MAX_NOTIFICATION_ATTEMPTS = 5;

/** Ceiling on rows touched per run, so one bad day cannot blow the 60s budget. */
const SWEEP_LIMIT = 25;

/**
 * Ignore rows touched more recently than this. A row inserted by
 * runNotification is at 'pending' while its send is still in flight (8s
 * ceiling); picking it up here would double-send. Five minutes is far past
 * any legitimate in-flight window.
 */
const SWEEP_MIN_AGE_MS = 5 * 60 * 1000;

type SweepRow = {
  id: string;
  order_id: string;
  event: OrderNotificationEvent;
  status: string;
  subject: string | null;
  attempts: number;
  error: string | null;
};

/** A row that has exhausted its retries. Reported, never silently dropped. */
export type CappedNotification = {
  id: string;
  order_id: string;
  event: OrderNotificationEvent;
  attempts: number;
  subject: string | null;
  error: string | null;
};

export type NotificationSweepResult = {
  /** Rows found at status <> 'sent' and old enough to touch. */
  scanned: number;
  /** Rows that sent successfully this run. */
  sent: number;
  /** Rows that failed again this run. */
  failed: number;
  /** Rows at or over the attempt cap — reported below, not retried. */
  capped: number;
  /** Rows another worker claimed between the read and the write. */
  raced: number;
  cappedRows: CappedNotification[];
  /** Present only if the sweep itself broke; caller records and keeps going. */
  error?: string;
};

/**
 * Rebuild and re-send every unsent order alert. Never throws.
 *
 * Uses the partial index on (created_at desc) WHERE status <> 'sent'.
 *
 * Concurrency: the daily cron and a manual admin trigger can overlap. Each row
 * is claimed with a compare-and-swap on `attempts` (plus the same staleness
 * bound as the read), so exactly one worker can own a row per attempt — the
 * other sees zero rows updated and skips it. The bump happens BEFORE the send,
 * so a run that dies mid-send still burns an attempt and cannot loop forever.
 */
export async function sweepOrderNotifications(): Promise<NotificationSweepResult> {
  const result: NotificationSweepResult = {
    scanned: 0,
    sent: 0,
    failed: 0,
    capped: 0,
    raced: 0,
    cappedRows: [],
  };

  const cutoff = new Date(Date.now() - SWEEP_MIN_AGE_MS).toISOString();

  const { data, error } = await supabaseAdmin
    .from("order_notifications_sent")
    .select("id, order_id, event, status, subject, attempts, error")
    .neq("status", "sent")
    .lt("updated_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(SWEEP_LIMIT);

  if (error) {
    console.error("[order-notification:sweep] read failed:", error.message);
    return { ...result, error: error.message };
  }

  const rows = (data ?? []) as SweepRow[];
  result.scanned = rows.length;

  for (const row of rows) {
    if (row.attempts >= MAX_NOTIFICATION_ATTEMPTS) {
      result.capped += 1;
      result.cappedRows.push({
        id: row.id,
        order_id: row.order_id,
        event: row.event,
        attempts: row.attempts,
        subject: row.subject,
        error: row.error,
      });
      continue;
    }

    const nowIso = new Date().toISOString();

    // Claim: bump attempts only if nobody else has. `.eq("attempts", ...)`
    // is the version check; `.lt("updated_at", cutoff)` re-asserts the
    // staleness bound the read used, closing the window where two workers
    // read the same row before either wrote.
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("order_notifications_sent")
      .update({ attempts: row.attempts + 1, updated_at: nowIso })
      .eq("id", row.id)
      .eq("attempts", row.attempts)
      .lt("updated_at", cutoff)
      .select("id")
      .maybeSingle();

    if (claimErr) {
      console.error(
        `[order-notification:sweep] ${row.id}: claim failed:`,
        claimErr.message,
      );
      result.failed += 1;
      continue;
    }
    if (!claimed) {
      result.raced += 1;
      continue;
    }

    const recordFailure = async (reason: string) => {
      result.failed += 1;
      console.error(
        `[order-notification:sweep] ${row.event} ${row.order_id} retry ${row.attempts + 1} FAILED: ${reason}`,
      );
      await supabaseAdmin
        .from("order_notifications_sent")
        .update({
          status: "failed",
          error: reason.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    };

    // Rebuild from current committed state rather than re-using the stored
    // subject: the order may have been edited since it failed, and a retry
    // should describe the order as it is now.
    const prepared = await prepareMessage(row.order_id, row.event);
    if (!prepared.ok) {
      await recordFailure(prepared.reason);
      continue;
    }

    const sent = await sendEmail(prepared);
    if (!sent.ok) {
      await recordFailure(sent.error);
      continue;
    }

    const { error: updErr } = await supabaseAdmin
      .from("order_notifications_sent")
      .update({
        status: "sent",
        resend_id: sent.resendId,
        subject: prepared.subject,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (updErr) {
      // Same trade as runNotification: the email went out, the bookkeeping
      // did not, so this row will be swept again and alert twice.
      console.error(
        `[order-notification:sweep] ${row.id}: sent (${sent.resendId}) but status update failed:`,
        updErr.message,
      );
    }
    result.sent += 1;
  }

  if (result.capped > 0) {
    console.error(
      `[order-notification:sweep] ${result.capped} row(s) at the ${MAX_NOTIFICATION_ATTEMPTS}-attempt cap — these alerts will never send without manual action:`,
      result.cappedRows.map((r) => `${r.event} ${r.order_id} (${r.error ?? "no error recorded"})`),
    );
  }

  return result;
}
