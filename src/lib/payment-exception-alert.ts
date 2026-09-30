// The doorbell for a payment_exceptions row.
//
// Fires from /api/razorpay-webhook the moment money is captured that this
// system refused to act on automatically — a payment matching nothing we can
// identify, or a payment for an amount that is not the amount owed.
//
// THIS IS NOT THE SYSTEM OF RECORD. The row is. This email is the least
// durable of the three surfaces (row, worklist, doorbell) and is deliberately
// allowed to fail: if Resend has a bad day the money is still sitting in
// payment_exceptions tomorrow morning. Do not "simplify" by making the alert
// the only trace — that is exactly the arrangement this whole change replaced.
//
// THE PAYLOAD NEVER LEAVES THE DATABASE.
// payment_exceptions has RLS on, zero policies and grants revoked from anon and
// authenticated precisely because `payload` is Razorpay's raw event: customer
// contact details and card metadata. Mailing it would hand all of that to
// whatever inbox, phone and mail provider the alert list resolves to, and every
// forward thereafter — defeating the table's own access posture through its own
// doorbell. So this carries only what is needed to go and look: the exception
// id, why it was raised, how much, and the razorpay ids to search on. Anyone
// who needs the rest reads the row as service_role.
//
// NEVER THROWS. Razorpay must still get its 200; a failed internal email must
// not turn an exception we successfully recorded into a webhook retry.

import { Resend } from "resend";
import { waitUntil } from "@vercel/functions";

import { ALERT_EMAILS, FROM_EMAIL } from "@/lib/alert-emails";

const LOG = "[payment-exception-alert]";

export type PaymentExceptionAlertInput = {
  /** payment_exceptions.id — the thing to look up. */
  id: string;
  reason: "unattributed" | "amount_mismatch";
  /** Null when the event stated no amount; see the webhook route. */
  amountPaise: number | null;
  /** What was owed, for a mismatch. Null for an unattributed payment — there
   *  is no parent to owe anything. */
  expectedPaise?: number | null;
  razorpayPaymentId?: string | null;
  razorpayOrderId?: string | null;
  /** Our own order reference (OLF…), when the row belongs to one. */
  orderRef?: string | null;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) {
    return "amount not stated in the event";
  }
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

const HEADLINE: Record<PaymentExceptionAlertInput["reason"], string> = {
  unattributed: "Money captured for an order we cannot identify",
  amount_mismatch: "Money captured for the wrong amount",
};

const EXPLANATION: Record<PaymentExceptionAlertInput["reason"], string> = {
  unattributed:
    "Razorpay captured this payment, but its order id matches no order and no " +
    "subscription of ours. We do not know who it is for. Nothing has been " +
    "marked paid.",
  amount_mismatch:
    "Razorpay captured this payment against a real order, but not for the " +
    "amount owed. It has NOT been marked paid: marking it would understate " +
    "the debt, and ignoring it would lose a real payment. This is a decision " +
    "for a person.",
};

async function send(x: PaymentExceptionAlertInput): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Not worth escalating — the row is written and durable either way.
    // Logged so an operator can tell the doorbell was never wired.
    console.error(`${LOG} RESEND_API_KEY not set — alert skipped for ${x.id}`);
    return;
  }

  const amount = rupees(x.amountPaise);
  const subject = `${HEADLINE[x.reason]} — ${amount}`;

  const facts: Array<[string, string]> = [
    ["Captured", amount],
    ...(x.reason === "amount_mismatch"
      ? ([["Amount owed", rupees(x.expectedPaise)]] as Array<[string, string]>)
      : []),
    ...(x.orderRef ? ([["Order", x.orderRef]] as Array<[string, string]>) : []),
    ...(x.razorpayPaymentId
      ? ([["Razorpay payment", x.razorpayPaymentId]] as Array<[string, string]>)
      : []),
    ...(x.razorpayOrderId
      ? ([["Razorpay order", x.razorpayOrderId]] as Array<[string, string]>)
      : []),
    ["Exception id", x.id],
  ];

  const text = [
    HEADLINE[x.reason],
    "",
    EXPLANATION[x.reason],
    "",
    ...facts.map(([k, v]) => `${k.padEnd(18)}${v}`),
    "",
    "The full Razorpay event is stored with the row and is not repeated here —",
    "it carries the customer's contact details and card metadata. Open the row",
    "to see it.",
    "",
    "This stays unresolved in payment_exceptions until someone closes it with",
    "a note. Nothing auto-resolves.",
  ].join("\n");

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px">
      <h2 style="margin:0 0 4px;font-size:18px;color:#991B1B">
        ${escapeHtml(HEADLINE[x.reason])}
      </h2>
      <p style="font-size:14px;color:#333;margin:12px 0">
        ${escapeHtml(EXPLANATION[x.reason])}
      </p>
      <table style="font-size:14px;border-collapse:collapse;margin:16px 0">
        ${facts
          .map(
            ([k, v]) =>
              `<tr><td style="padding:4px 12px 4px 0;color:#666">${escapeHtml(k)}</td>
            <td style="padding:4px 0">${escapeHtml(v)}</td></tr>`,
          )
          .join("")}
      </table>
      <p style="font-size:14px;color:#666;margin:16px 0 0">
        The full Razorpay event is stored with the row and is not repeated here —
        it carries the customer's contact details and card metadata. This stays
        unresolved in <code>payment_exceptions</code> until someone closes it with
        a note. Nothing auto-resolves.
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
    console.error(`${LOG} send failed for ${x.id}:`, error.message);
  }
}

/**
 * Fire-and-forget. Never throws, never rejects, never delays the response.
 *
 * waitUntil is imported statically and called synchronously on purpose: Vercel
 * may freeze the invocation the moment its response is returned, and a bare
 * floating promise would be killed mid-send. Outside a Vercel request context
 * (local dev, scripts) waitUntil is a no-op that does not throw.
 *
 * CALL THIS ONLY WHEN A ROW WAS ACTUALLY INSERTED. The webhook inserts with
 * `on conflict do nothing returning id` and rings this only on a real insert,
 * so a Razorpay retry storm cannot become an email storm — which is precisely
 * when the channel would be carrying real news.
 */
export function queuePaymentExceptionAlert(x: PaymentExceptionAlertInput): void {
  try {
    const task = send(x).catch((e) => {
      // Last line of defence — an unhandled rejection inside waitUntil can take
      // down the invocation, and Razorpay would then retry a payment we have
      // already recorded.
      console.error(`${LOG} threw for ${x.id}:`, e);
    });
    waitUntil(task);
  } catch (e) {
    console.error(`${LOG} queue failed for ${x.id}:`, e);
  }
}
