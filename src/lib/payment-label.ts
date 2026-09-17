// The payment word. Two values, and only two:
//
//   PAID  — the money is in. Collect nothing.
//   COD   — it is not. Someone collects.
//
// Every surface that states payment goes through here: the rider's share
// message, the packing list, the order receipt and the subscription
// sheet. Each of those used to phrase it differently — the share message
// had four strings ("PAID - collect nothing", "NOT PAID - do not
// deliver", "PAYMENT UNCONFIRMED - check", "COLLECT Rs280"), the receipt
// printed "COD · Pending", the subscription page printed a humanised
// column value. Four vocabularies for one fact, and three of them leaked
// raw schema words — `created`, `abandoned`, `pending` — at a person
// holding a bag or a sheet of paper, to whom they mean nothing.
//
// WHY BINARY. Every not-paid status ends the same way at the door: take
// the money. `pending`, `created` and `abandoned` differ only in how far
// a payment attempt got, which is an office question and not a doorstep
// one. Collapsing them also removes the worst reading of the old copy —
// a rider seeing "PAYMENT UNCONFIRMED - check" and deciding that meant
// don't collect.
//
// METHOD IS NEVER READ, ONLY STATUS. A row that says `cod` + `paid` HAS
// been paid: Pay Now converts a COD order online and deliberately leaves
// payment_method alone. Reading method would tell the rider to collect a
// second time on an order already settled.

/**
 * "Rs1,440". Deliberately NOT formatINR() — that emits "₹", and the rupee
 * glyph still renders as an empty box on some of the cheap Android
 * handsets our riders carry. An unreadable amount is worse than an ugly
 * one. Printed sheets could afford "₹", but this is one string reaching
 * four surfaces and the handset is the one that breaks.
 */
export function rupees(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const whole = Math.round(safe * 100) / 100;
  const body = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(whole);
  return `Rs${body}`;
}

/**
 * Has the money reached us?
 *
 * Matched by PREFIX, which buys exactly one thing: `paid_orphaned` — a
 * subscription whose payment captured but which never got deliveries
 * scheduled against it (see the orphan sweeper). The money has already
 * left the customer. Under a strict `status === "paid"` test it would
 * fall through to COD and a rider would take it a second time, so it is
 * the one status that must not be read literally. Any future `paid_*`
 * variant is safe by the same rule.
 */
export function isPaidStatus(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase().startsWith("paid");
}

export type PaymentFacts = {
  payment_status?: string | null;
  /**
   * Cash due AT THIS STOP, in rupees, or null when this surface is not
   * talking about a single stop.
   *
   * For a subscription this is ONE delivery's share of the plan, never
   * the plan total — see subscription-share-message.ts. Pass null rather
   * than a guess: a rider reads this at a door and asks for exactly what
   * it says, and the label degrades to a bare "COD" which is still true.
   */
  amountDue?: number | null;
};

/**
 * The only payment string any operator or rider is shown.
 *
 *   paid / paid_orphaned  → "PAID"
 *   anything else, amount known   → "COD Rs340"
 *   anything else, amount unknown → "COD"
 */
export function paymentLabel(p: PaymentFacts): string {
  if (isPaidStatus(p.payment_status)) return "PAID";
  const due = p.amountDue;
  return typeof due === "number" && Number.isFinite(due) && due > 0
    ? `COD ${rupees(due)}`
    : "COD";
}
