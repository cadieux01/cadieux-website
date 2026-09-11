// The doorbell for an orphaned subscription payment.
//
// Fires from the verify request path the moment Razorpay's money lands against
// a subscription the sweeper had already written off. Sunny needs to know today
// — a customer is sitting there having paid for bread nobody is going to bake.
//
// THIS IS NOT THE SYSTEM OF RECORD. It is best-effort notification on top of
// two more durable surfaces: the row's own 'paid_orphaned' status on the admin
// subscriptions board, and the daily re-report in
// @/lib/cron/orphaned-payments. If this send fails, the money is still
// discoverable tomorrow morning. That layering is deliberate — do not "simplify"
// it by making this the only alert.
//
// It deliberately reuses order-notification.ts's waitUntil discipline but NOT
// its retry queue: order_notifications_sent is keyed on a NOT NULL order_id and
// has no subscription equivalent. Rather than make that table polymorphic for
// one caller, the daily phase covers the retry gap more cheaply.
//
// NEVER THROWS. A customer's verify response must not fail because an internal
// email did — they have already paid, and the row is already correct.

import { Resend } from "resend";
import { waitUntil } from "@vercel/functions";

import { ALERT_EMAILS, FROM_EMAIL } from "@/lib/alert-emails";
import { formatSubscriptionNumber } from "@/lib/order-number";

const LOG = "[orphaned-payment-alert]";

export type OrphanedAlertInput = {
  id: string;
  subscription_number?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  total_amount?: number | string | null;
  razorpay_payment_id: string;
  razorpay_order_id?: string | null;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function send(sub: OrphanedAlertInput): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Not an error worth escalating: the board and the daily phase still have
    // the row. Logged so an operator can tell the doorbell was never wired.
    console.error(`${LOG} RESEND_API_KEY not set — alert skipped for ${sub.id}`);
    return;
  }

  const ref = formatSubscriptionNumber({
    id: sub.id,
    subscription_number: sub.subscription_number,
  });
  const amount =
    sub.total_amount === null || sub.total_amount === undefined
      ? "unknown amount"
      : `₹${Number(sub.total_amount).toLocaleString("en-IN")}`;
  const name = sub.customer_name?.trim() || "Unknown customer";
  const phone = sub.customer_phone?.trim() || "no phone on file";

  const subject = `Payment received for a cancelled subscription — ${ref} (${amount})`;

  const text = [
    `${name} paid ${amount} for subscription ${ref}, but the payment arrived`,
    `after we had already written the subscription off. Nothing is scheduled`,
    `and the deliveries are cancelled.`,
    ``,
    `We are holding this money. It needs a decision — refund in full, or`,
    `reinstate the subscription on fresh dates.`,
    ``,
    `Customer:        ${name}`,
    `Phone:           ${phone}`,
    `Amount:          ${amount}`,
    `Subscription:    ${ref}`,
    `Razorpay payment: ${sub.razorpay_payment_id}`,
    sub.razorpay_order_id ? `Razorpay order:   ${sub.razorpay_order_id}` : "",
    ``,
    `The customer has been told we will call them within 24 hours.`,
    ``,
    `This subscription is on the admin board at payment status`,
    `"paid_orphaned" until it is resolved.`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px">
      <h2 style="margin:0 0 4px;font-size:18px;color:#991B1B">
        Payment received for a cancelled subscription
      </h2>
      <p style="font-size:14px;color:#333;margin:12px 0">
        <strong>${escapeHtml(name)}</strong> paid <strong>${escapeHtml(amount)}</strong>
        for subscription <strong>${escapeHtml(ref)}</strong>, but it arrived after we
        had already written the subscription off. Nothing is scheduled and the
        deliveries are cancelled.
      </p>
      <p style="font-size:14px;color:#333;margin:12px 0">
        We are holding this money. It needs a decision — <strong>refund in full</strong>,
        or <strong>reinstate on fresh dates</strong>.
      </p>
      <table style="font-size:14px;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Customer</td>
            <td style="padding:4px 0">${escapeHtml(name)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Phone</td>
            <td style="padding:4px 0"><a href="tel:${escapeHtml(phone)}" style="color:#024628">${escapeHtml(phone)}</a></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Amount</td>
            <td style="padding:4px 0">${escapeHtml(amount)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Subscription</td>
            <td style="padding:4px 0">${escapeHtml(ref)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Razorpay payment</td>
            <td style="padding:4px 0">${escapeHtml(sub.razorpay_payment_id)}</td></tr>
        ${
          sub.razorpay_order_id
            ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Razorpay order</td>
            <td style="padding:4px 0">${escapeHtml(sub.razorpay_order_id)}</td></tr>`
            : ""
        }
      </table>
      <p style="font-size:14px;color:#666;margin:16px 0 0">
        The customer has been told we will call them within 24 hours. This row stays
        on the admin board at payment status <code>paid_orphaned</code> until resolved.
      </p>
    </div>`;

  const { error } = await new Resend(key).emails.send({
    from: FROM_EMAIL,
    to: ALERT_EMAILS,
    subject,
    html,
    text,
  });

  if (error) {
    console.error(`${LOG} send failed for ${sub.id}:`, error.message);
  }
}

/**
 * Fire-and-forget the orphan alert. Never throws, never rejects, never delays
 * the caller.
 *
 * waitUntil is imported statically and called synchronously on purpose: Vercel
 * may freeze the invocation the moment its response is returned, and a bare
 * floating promise would be killed mid-send. Outside a Vercel request context
 * (local dev, tests) waitUntil is a no-op that does not throw, so the promise
 * simply runs to completion.
 */
export function queueOrphanedPaymentAlert(sub: OrphanedAlertInput): void {
  try {
    const task = send(sub).catch((e) => {
      // Last line of defence — an unhandled rejection inside waitUntil can take
      // down the invocation, which WOULD affect the customer.
      console.error(`${LOG} threw for ${sub.id}:`, e);
    });
    waitUntil(task);
  } catch (e) {
    console.error(`${LOG} queue failed for ${sub.id}:`, e);
  }
}
