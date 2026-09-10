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

// ── core ────────────────────────────────────────────────────────────────────

async function runNotification(
  orderId: string,
  event: OrderNotificationEvent,
): Promise<void> {
  const { data, error: readErr } = await supabaseAdmin
    .from("orders")
    .select(
      "id, order_number, total_amount, delivery_fee, items, delivery_address, delivery_date, delivery_slot, payment_method, payment_status, fulfillment_type, pickup_location_id, created_at, customers(full_name, phone)",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (readErr || !data) {
    console.error(
      `[order-notification] ${event} ${orderId}: order re-read failed:`,
      readErr?.message ?? "not found",
    );
    return;
  }
  const order = data as unknown as OrderRow;

  // Re-assert the trigger condition against committed state rather than
  // trusting the caller. A route that fires 'paid' on a row whose UPDATE was
  // rolled back, or 'created' on an online order, is a bug we should not turn
  // into an email.
  if (event === "paid" && order.payment_status !== "paid") {
    console.warn(
      `[order-notification] paid ${orderId}: order is not paid (${order.payment_status}) — skipping.`,
    );
    return;
  }

  // Has this order already produced an email? Decides "New order" vs
  // "Payment received", and is read before the insert so the losing side of
  // the verify-payment/webhook race never gets this far.
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

  const { subject, html, text } = buildMessage(
    order,
    event,
    isFirstEmailForOrder,
    pickupLabel,
  );

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

  if (!process.env.RESEND_API_KEY) {
    await markFailed("RESEND_API_KEY is not configured");
    return;
  }

  let resendId: string | null = null;
  try {
    // Resend's REST endpoint rather than its SDK: the SDK's send options have
    // no `signal`, so an SDK call cannot be cancelled and a hung connection
    // would sit inside waitUntil until the platform killed the invocation —
    // with the row stuck at 'pending' and no error recorded. fetch + an abort
    // signal gives a real deadline and a loggable failure. Same endpoint and
    // payload shape as supabase/functions/_shared/handoff-email.ts.
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: TO_EMAIL, subject, html, text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      await markFailed(`HTTP ${res.status} ${detail}`.trim());
      return;
    }
    const sendData = (await res.json().catch(() => null)) as { id?: string } | null;
    resendId = sendData?.id ?? null;
  } catch (e) {
    await markFailed(
      e instanceof Error ? `${e.name}: ${e.message}` : "Unknown send error",
    );
    return;
  }

  const { error: updErr } = await supabaseAdmin
    .from("order_notifications_sent")
    .update({ status: "sent", resend_id: resendId, updated_at: new Date().toISOString() })
    .eq("id", rowId);
  if (updErr) {
    // The email DID go out; only the bookkeeping failed. Leaving the row at
    // 'pending' is the safe error — it over-reports failure rather than
    // under-reporting it, and the unique index still blocks a resend.
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
