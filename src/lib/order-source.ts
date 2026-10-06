// Where an order / subscription came from. Backs public.orders.source and
// public.subscriptions.source (migration 20260929201700).
//
// THE COLUMN IS NULLABLE WITH NO DEFAULT, AND THAT IS LOSS-BEARING.
// Every row written before 2026-09-30 has source NULL — 400 orders and 60
// subscriptions — and so does any future insert path that forgets to stamp it.
// NULL means UNKNOWN. It does NOT mean 'web'.
//
// So: test `source === "offline"`, never `source !== "web"`. The second form
// labels 400 rows of history as offline orders that nobody entered by hand.
// `isOfflineSource` below is the only comparison any display code should make.
//
// SEPARATE FROM PAYMENT STATE. An offline order can be paid (operator
// collected cash) and a web order can be unpaid (COD, or a subscription whose
// money never arrived). The two flags cross freely and neither may be derived
// from the other. Payment state has its own predicate — `isPaidStatus` in
// @/lib/payment-label — and the red "unpaid" treatment must key on THAT, never
// on source. Keying red on source would leave OLS10 (a web subscription,
// unpaid, ₹1,440, active since 5 September) invisible, which is the exact bug
// this pair of flags exists to stop.
//
// ONE CREATION PATH IS NOT COVERED BY THE TYPE SYSTEM: the Postgres function
// `admin_create_split_orders`, which inserts the OLF/OLW pair for a sandwich
// order. It builds its INSERT dynamically —
//
//     insert into public.orders (<payload keys ∩ orders columns>)
//     select ... from jsonb_populate_record(null::public.orders, $1)
//
// — so it needs no migration to carry `source`, and equally it will never
// warn you that it is missing. WHOEVER WIRES THE SANDWICH CHECKOUT MUST PUT
// `source` IN BOTH PAYLOADS; the RPC copies it only if it is there, and a
// TypeScript caller gets no compile error for leaving it out because the
// payload crosses into SQL as jsonb.
//
// Dormant as of 2026-10-06, which is why this is a note and not a fix:
// `payment_group_id` is non-null on 0 of 658 orders and the RPC has no caller
// in the repo. The split has never run in production.

export type OrderSource = "web" | "app" | "offline";

/** True only for rows explicitly stamped 'offline'. NULL/unknown is false. */
export function isOfflineSource(
  source: string | null | undefined,
): boolean {
  return source === "offline";
}

/** Human label for a source, or null when we genuinely do not know. */
export function sourceLabel(source: string | null | undefined): string | null {
  switch (source) {
    case "offline":
      return "Offline";
    case "app":
      return "App";
    case "web":
      return "Web";
    default:
      return null;
  }
}
