// Which subscription rows a human is allowed to see.
//
// A prepaid subscription row is INSERTED BEFORE the customer pays — see the
// comment above createSubscriptionRazorpayOrder in /api/checkout. That order
// is deliberate: the alternative (insert after verification) can take money
// and then lose the record of what was ordered. The cost of this choice is
// that an abandoned Razorpay sheet leaves an unpaid row behind.
//
// Those rows must never reach a customer list, an admin list, or the
// fulfilment floor. They are hidden here rather than deleted so the audit
// trail survives — a real payment that later reconciles can still be found.
//
//   created    → row written, Razorpay order raised, nobody has paid yet
//   abandoned  → the sweeper cron gave up on it (see
//                /api/cron/sweep-abandoned-subscriptions)
//
// Nothing else is hidden. 'pending' is a real, paid-or-COD-era subscription.

/** Statuses that mean "this subscription was never paid for". */
export const UNPAID_SUBSCRIPTION_STATUSES = ["created", "abandoned"] as const;

/**
 * PostgREST value for `.not("payment_status", "in", ...)`.
 *
 * NOTE ON NULLS: PostgREST `NOT IN` is SQL `NOT IN`, which is NULL-unsafe —
 * a row with payment_status NULL would be excluded too. Every existing row
 * has a non-null payment_status and all four insert paths set one, so this
 * is safe today. If a nullable path is ever added, switch these call sites
 * to `.or("payment_status.is.null,payment_status.not.in.(...)")`.
 */
export const UNPAID_SUBSCRIPTION_FILTER = `(${UNPAID_SUBSCRIPTION_STATUSES.join(",")})`;

/** Client-side/in-memory equivalent for rows already fetched. */
export function isUnpaidSubscription(
  row: { payment_status?: string | null } | null | undefined,
): boolean {
  const s = row?.payment_status;
  return (
    typeof s === "string" &&
    (UNPAID_SUBSCRIPTION_STATUSES as readonly string[]).includes(s)
  );
}
