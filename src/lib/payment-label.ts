// Payment, said two different ways on purpose.
//
// THE CONTRACT BETWEEN THE TWO FUNCTIONS IN THIS FILE. They are not two
// spellings of one fact and must not be consolidated:
//
//   paymentLabel()  is THE RIDER'S INSTRUCTION. Binary — PAID or COD.
//                   Reads STATUS ONLY, never method. `paid*` by PREFIX.
//                   The question it answers is "do I take money at this
//                   door", and that has exactly two answers.
//
//   paymentView()   is THE ADMIN'S DIAGNOSIS. Four outcomes — Paid,
//                   Failed, COD, Awaiting. It DOES read method, because
//                   the office question is "what happened to this
//                   payment attempt", which method is half the answer to.
//
// THEY DISAGREE, DELIBERATELY, ON ONE BUCKET. A `razorpay` + `created`
// row (34 of them live as of 2026-10-01) reads "Awaiting" on the board
// and "COD" on the rider's sheet. Both are correct: an attempt was
// started and never completed, so the office wants it visible as
// unresolved — and no money has arrived, so the rider must collect.
// Anyone who "unifies" these two functions reintroduces the bug that
// sent a rider to a door with nothing to collect against.
//
// The one thing they are NOT allowed to disagree about is whether the
// money arrived: both route that through isPaidStatus().
//
// ─────────────────────────────────────────────────────────────────────
//
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
 * "₹1,440".
 *
 * This briefly emitted "Rs" instead, on the theory that the rupee glyph
 * boxes on cheap Android handsets. That was true of Android 4.x and is
 * not true of anything a rider is carrying now, so the reason is retired
 * and the real symbol is back. Do not reintroduce "Rs" without a handset
 * that actually fails.
 */
export function rupees(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const whole = Math.round(safe * 100) / 100;
  const body = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(whole);
  return `₹${body}`;
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
 *   anything else, amount known   → "COD ₹340"
 *   anything else, amount unknown → "COD"
 */
export function paymentLabel(p: PaymentFacts): string {
  if (isPaidStatus(p.payment_status)) return "PAID";
  const due = p.amountDue;
  return typeof due === "number" && Number.isFinite(due) && due > 0
    ? `COD ${rupees(due)}`
    : "COD";
}

/* ------------------------------------------------------------------ *
 * THE ADMIN'S DIAGNOSIS
 *
 * Moved here from a private PaymentBadge inside /admin/orders/page.tsx.
 * It moved because it stopped being presentation the moment payment
 * became a FILTER: the badge the operator reads and the group they
 * filter by have to be the same four buckets, or the menu offers a word
 * the table never prints. One function decides both.
 *
 * Colour stays in the component. The outcome is the shared fact; cream
 * and amber are the orders board's business.
 * ------------------------------------------------------------------ */

/**
 * The four live buckets, plus `unknown` for a row carrying neither
 * method nor status.
 *
 * ORDER IS THE MENU ORDER — operator order, settled first.
 *
 * APPENDING A FIFTH IS THE WHOLE EXTENSION POINT. Add the value here,
 * a label in PAYMENT_VIEW_LABELS, and a branch in paymentView(); the
 * URL codec, the filter group and the dropdown all derive from this
 * array and need no edit. (A `cod_settled_method` column is landing
 * separately — when it does, this is where its bucket goes.)
 */
export const PAYMENT_VIEWS = [
  "paid",
  "cod",
  "awaiting",
  "failed",
  "unknown",
] as const;

export type PaymentView = (typeof PAYMENT_VIEWS)[number];

export function isPaymentView(v: unknown): v is PaymentView {
  return typeof v === "string" && (PAYMENT_VIEWS as readonly string[]).includes(v);
}

/** What the operator sees — in the badge and in the filter menu, the same
 *  word in both. `unknown` prints the em dash the badge always printed. */
export const PAYMENT_VIEW_LABELS: Record<PaymentView, string> = {
  paid: "Paid",
  cod: "COD",
  awaiting: "Awaiting",
  failed: "Failed",
  unknown: "—",
};

/**
 * Which bucket this order's payment sits in.
 *
 * `unknown` (neither field set) is a real outcome and still a valid
 * filter value, but it is NOT offered in the dropdown — no order has
 * ever carried it. Same treatment as `pending_payment` and `picked_up`
 * in the status group: reachable from a URL, not worth a menu line.
 */
export function paymentView(p: {
  payment_method?: string | null;
  payment_status?: string | null;
}): PaymentView {
  const m = (p.payment_method ?? "").trim().toLowerCase();
  const s = (p.payment_status ?? "").trim().toLowerCase();

  // Prefix-matched, exactly as paymentLabel does it. The badge used to
  // test `s === "paid"`, which would have shown "Awaiting" on a
  // `paid_orphaned` row whose money HAD arrived. No order row has ever
  // carried one (the orphan sweeper is subscriptions-only), so this
  // changes nothing live — but "has the money arrived" must not have two
  // answers in one file.
  if (isPaidStatus(s)) return "paid";
  if (s === "failed") return "failed";
  if (m === "cod") return "cod";
  if (!m && !s) return "unknown";
  return "awaiting";
}
