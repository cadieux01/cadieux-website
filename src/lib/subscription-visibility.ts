// Which subscription rows a human is allowed to see.
//
// A prepaid subscription row is INSERTED BEFORE the customer pays — see the
// comment above createSubscriptionRazorpayOrder in /api/checkout. That order
// is deliberate: the alternative (insert after verification) can take money
// and then lose the record of what was ordered. The cost of this choice is
// that an abandoned Razorpay sheet leaves an unpaid row behind.
//
// Rows are hidden here rather than deleted so the audit trail survives — a
// real payment that later reconciles can still be found.
//
//   created        → row written, Razorpay order raised, nobody has paid yet
//   abandoned      → the sweeper gave up on it (see
//                    @/lib/sweep-abandoned-subscriptions)
//   paid_orphaned  → a payment verified AFTER the sweep had already written
//                    the row off. Money is held, the deliveries are cancelled,
//                    and only Sunny can decide refund-vs-reinstate. See the
//                    orphan branch in @/lib/subscription-payment.
//
// Nothing else is hidden. 'pending' is a real, paid-or-COD-era subscription.
//
// TWO SETS, AND THE DIFFERENCE IS LOAD-BEARING
// 'paid_orphaned' is hidden from customers but MUST stay visible to Sunny.
// Hiding it everywhere is how "paid but deleted" becomes "paid but invisible":
// Razorpay holds the customer's money and no screen in the business shows it.
// So the admin worklists deliberately use the narrower ADMIN_ set.
//
//   HIDDEN_*        → customer surfaces, and anything modelling "a live
//                     subscription" (overview MRR/revenue). An orphan is not
//                     live revenue — it is pending a refund or a restart.
//   ADMIN_HIDDEN_*  → admin worklists where Sunny is expected to ACT. Only
//                     genuinely unpaid shells are suppressed; orphans show up.

/** Never paid for. Suppressed on every surface, customer and admin alike. */
export const UNPAID_SUBSCRIPTION_STATUSES = ["created", "abandoned"] as const;

/**
 * Hidden from customers and from live-subscription metrics.
 *
 * Superset of UNPAID_SUBSCRIPTION_STATUSES: adds 'paid_orphaned', where the
 * money did arrive but nothing is scheduled against it.
 */
export const HIDDEN_SUBSCRIPTION_STATUSES = [
  ...UNPAID_SUBSCRIPTION_STATUSES,
  "paid_orphaned",
] as const;

/** Hidden from admin worklists. Orphans are NOT in here — that is the point. */
export const ADMIN_HIDDEN_SUBSCRIPTION_STATUSES = UNPAID_SUBSCRIPTION_STATUSES;

/**
 * PostgREST value for `.not("payment_status", "in", ...)`.
 *
 * NOTE ON NULLS: PostgREST `NOT IN` is SQL `NOT IN`, which is NULL-unsafe —
 * a row with payment_status NULL would be excluded too. Every existing row
 * has a non-null payment_status and all four insert paths set one, so this
 * is safe today. If a nullable path is ever added, switch these call sites
 * to `.or("payment_status.is.null,payment_status.not.in.(...)")`.
 */
export const HIDDEN_SUBSCRIPTION_FILTER = `(${HIDDEN_SUBSCRIPTION_STATUSES.join(",")})`;

/** Admin-worklist counterpart of HIDDEN_SUBSCRIPTION_FILTER. Same NULL caveat. */
export const ADMIN_HIDDEN_SUBSCRIPTION_FILTER = `(${ADMIN_HIDDEN_SUBSCRIPTION_STATUSES.join(",")})`;

/** Client-side/in-memory equivalent for rows already fetched. Customer rules. */
export function isHiddenSubscription(
  row: { payment_status?: string | null } | null | undefined,
): boolean {
  const s = row?.payment_status;
  return (
    typeof s === "string" &&
    (HIDDEN_SUBSCRIPTION_STATUSES as readonly string[]).includes(s)
  );
}

/** True for a payment that landed after the row was already written off. */
export function isOrphanedPayment(
  row: { payment_status?: string | null } | null | undefined,
): boolean {
  return row?.payment_status === "paid_orphaned";
}
