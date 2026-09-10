// Extracted from the pre-consolidation /api/cron/abandoned-payments route so
// the new /api/cron/daily-housekeeping runner can invoke it as one of three
// sequential phases, each wrapped in its own try/catch. Behaviour, thresholds,
// email content, and log tag are preserved byte-for-byte from the old inline
// implementation — this is a code move, not a rewrite.
//
// See the old route header for the rationale (30-min stale cutoff, 24h window,
// 10-min recovery window, two-recipient list). Not repeated here.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Resend } from "resend";

const MINUTE_MS = 60 * 1000;
/** How long a payment may legitimately be in progress before we call it dead. */
const STALE_AFTER_MS = 30 * MINUTE_MS;
/** Look-back window for the digest. */
const WINDOW_MS = 24 * 60 * MINUTE_MS;
/** A later successful order this close behind means the customer recovered. */
const RECOVERY_WINDOW_MS = 10 * MINUTE_MS;

const LOG = "[cron/daily-housekeeping:abandoned-payments]";

/** Render a timestamp as "9:14 pm" in IST. */
function istTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Render a timestamp as "Sat, 6 Sep" in IST. */
function istDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface OrderRow {
  id: string;
  order_number: string | null;
  customer_id: string | null;
  total_amount: number | null;
  payment_status: string | null;
  payment_method: string | null;
  fulfillment_type: string | null;
  created_at: string;
  customers: { full_name: string | null; phone: string | null } | null;
}

/** A row that represents money that actually arrived (or was promised on COD). */
function isSuccessful(o: OrderRow): boolean {
  return o.payment_status === "paid" || o.payment_method === "cod";
}

export type AbandonedDigestResult = {
  /** Rows that matched the abandoned criteria (before recovery filter). */
  abandoned: number;
  /** Rows kept after removing the ones the customer recovered from. */
  lost: number;
  /** Whether an email was actually sent this run. False on 0-lost or send failure. */
  sent: boolean;
  /** Present only when something went wrong; caller records but keeps going. */
  error?: string;
};

export async function runAbandonedPaymentsDigest(
  supabase: SupabaseClient,
  resend: Resend,
  fromEmail: string,
  alertEmails: string[],
): Promise<AbandonedDigestResult> {
  const now = Date.now();
  const windowStart = new Date(now - WINDOW_MS).toISOString();

  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, order_number, customer_id, total_amount, payment_status, payment_method, fulfillment_type, created_at, customers(full_name, phone)",
    )
    .gte("created_at", windowStart)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`${LOG} order fetch failed:`, error.message);
    return { abandoned: 0, lost: 0, sent: false, error: error.message };
  }

  const rows = (data || []) as unknown as OrderRow[];

  const abandoned = rows.filter(
    (o) =>
      o.payment_status === "created" &&
      now - new Date(o.created_at).getTime() > STALE_AFTER_MS,
  );

  const lost = abandoned.filter((o) => {
    if (!o.customer_id) return true;
    const at = new Date(o.created_at).getTime();
    return !rows.some(
      (other) =>
        other.customer_id === o.customer_id &&
        other.id !== o.id &&
        isSuccessful(other) &&
        new Date(other.created_at).getTime() - at > 0 &&
        new Date(other.created_at).getTime() - at <= RECOVERY_WINDOW_MS,
    );
  });

  if (lost.length === 0) {
    return { abandoned: abandoned.length, lost: 0, sent: false };
  }

  const lines = lost.map((o) => {
    const name = (o.customers?.full_name || "Unknown").trim();
    const phone = o.customers?.phone || "no phone on file";
    const amount =
      typeof o.total_amount === "number" ? `₹${o.total_amount}` : "—";
    const kind = o.fulfillment_type === "pickup" ? "Pickup" : "Delivery";
    const ref = o.order_number || o.id.slice(0, 8).toUpperCase();
    return {
      ref,
      name,
      phone,
      amount,
      kind,
      when: `${istDate(o.created_at)}, ${istTime(o.created_at)}`,
    };
  });

  const subject = `${lost.length} started paying and didn't finish`;

  const text = [
    `${lost.length} ${lost.length === 1 ? "person" : "people"} opened the payment screen in the last 24 hours and never completed it.`,
    "",
    ...lines.map(
      (l) =>
        `${l.name} — ${l.phone}\n  ${l.amount} · ${l.kind} · ${l.when} · ${l.ref}`,
    ),
    "",
    "These are worth a call. They picked a product, entered an address and reached payment.",
  ].join("\n");

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:560px">
      <p style="font-size:16px;margin:0 0 16px">
        <strong>${lost.length}</strong> ${lost.length === 1 ? "person" : "people"}
        opened the payment screen in the last 24 hours and never completed it.
      </p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <tr style="text-align:left;color:#666">
          <th style="padding:6px 8px;border-bottom:1px solid #ddd">Customer</th>
          <th style="padding:6px 8px;border-bottom:1px solid #ddd">Amount</th>
          <th style="padding:6px 8px;border-bottom:1px solid #ddd">Type</th>
          <th style="padding:6px 8px;border-bottom:1px solid #ddd">When</th>
        </tr>
        ${lines
          .map(
            (l) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee">
            <strong>${escapeHtml(l.name)}</strong><br>
            <a href="tel:${escapeHtml(l.phone)}" style="color:#024628">${escapeHtml(l.phone)}</a><br>
            <span style="color:#999;font-size:12px">${escapeHtml(l.ref)}</span>
          </td>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(l.amount)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(l.kind)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(l.when)}</td>
        </tr>`,
          )
          .join("")}
      </table>
      <p style="font-size:14px;color:#666;margin:16px 0 0">
        These are worth a call. They picked a product, entered an address and
        reached payment.
      </p>
    </div>`;

  const { error: sendErr } = await resend.emails.send({
    from: fromEmail,
    to: alertEmails,
    subject,
    html,
    text,
  });

  if (sendErr) {
    console.error(`${LOG} send failed:`, sendErr.message);
    return {
      abandoned: abandoned.length,
      lost: lost.length,
      sent: false,
      error: sendErr.message,
    };
  }

  return { abandoned: abandoned.length, lost: lost.length, sent: true };
}
