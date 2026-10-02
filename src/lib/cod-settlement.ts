// Recording how a COD order's cash actually arrived.
//
// One action, not two: choosing the method also moves payment_status to
// 'paid'. Before this existed there was NO admin paid-transition for orders
// at all — only the four Razorpay routes could mark an order paid — so 179
// delivered COD orders (₹44,420, from 30 Aug) sat at 'pending' with the money
// already in the till.
//
// Imported by client components as well as the PATCH route, so everything
// here is pure: no Supabase client, no server-only imports. The dialog MUST
// compute the paid_at it is about to write from the same function the route
// uses, or the date shown to the admin and the date stored diverge.

import { isPaidStatus } from "@/lib/payment-label";

export const COD_SETTLED_METHODS = ["cash", "upi", "cash_upi"] as const;

export type CodSettledMethod = (typeof COD_SETTLED_METHODS)[number];

export function isCodSettledMethod(v: unknown): v is CodSettledMethod {
  return (
    typeof v === "string" &&
    (COD_SETTLED_METHODS as readonly string[]).includes(v)
  );
}

/** The words a person uses, not the stored token. */
export function codMethodLabel(m: CodSettledMethod): string {
  return m === "cash" ? "Cash" : m === "upi" ? "UPI" : "Cash and UPI";
}

/** Labels a value READ BACK from the column. The CHECK constrains what this
 *  code writes, but a row could have been written by hand, so an unknown
 *  token is shown verbatim rather than mislabelled or swallowed. */
export function codMethodDisplay(stored: string): string {
  return isCodSettledMethod(stored) ? codMethodLabel(stored) : stored;
}

type SettleableOrder = {
  payment_method?: string | null;
  payment_status?: string | null;
};

/** Is this an order whose cash is still to be recorded?
 *
 *  Only COD, and only while unpaid. `isPaidStatus` (prefix-based) rather than
 *  `=== "paid"` so a future paid_* variant also counts as settled and cannot
 *  be collected a second time. */
export function canSettleCod(order: SettleableOrder): boolean {
  return (
    (order.payment_method ?? "").trim().toLowerCase() === "cod" &&
    !isPaidStatus(order.payment_status)
  );
}

export type PaidAtSource =
  /** Order is already delivered; use the moment it was marked delivered. */
  | "delivered"
  /** Being settled at the door right now. */
  | "now"
  /** Delivered, but nothing on the row records when. Store no date. */
  | "unknown";

export type PaidAtDecision = { iso: string | null; source: PaidAtSource };

type PaidAtOrder = {
  status?: string | null;
  status_updated_at?: string | null;
};

/** Which moment the money arrived.
 *
 *  now() is right at the door and WRONG for the backlog: settling five weeks
 *  of delivered orders in one sitting would date August and September money as
 *  October, in a column the revenue figures read.
 *
 *  For a delivered order the moment is `status_updated_at`. That column is
 *  stamped ONLY inside the status branch of the admin PATCH
 *  (app/api/admin/orders/[id]/route.ts), so on a row whose current status is
 *  'delivered' it is the moment it was marked delivered.
 *
 *  Corroborated, not assumed: `audit_log` carries a
 *  meta->>'status_after' = 'delivered' row for ALL 179 of the delivered-unpaid
 *  COD orders, and it agrees with status_updated_at to within 60 seconds on
 *  178 of them. audit_log is NOT used as the source despite being the more
 *  direct record — it sits at exactly 4000 rows, i.e. a rolling cap, so it is
 *  not a durable archive and a row that ages out would silently lose its date.
 *  status_updated_at is on the order itself and cannot age out.
 *
 *  Known imprecision, deliberately left: status_updated_at is when someone
 *  PRESSED delivered, not when the bread reached the door. 85 of the 179 were
 *  marked the same day (IST); the rest run 1-9 days later, with one at 25.
 *  16 sit a day BEFORE their delivery_date, which is possible because the
 *  admin date-edit control moves delivery_date without touching
 *  status_updated_at. The control shows the date for exactly this reason —
 *  the admin can see a wrong one before saving.
 *
 *  A missing status_updated_at yields null, never a guess. */
export function settlementPaidAt(
  order: PaidAtOrder,
  nowIso: string,
): PaidAtDecision {
  const delivered = (order.status ?? "").trim().toLowerCase() === "delivered";
  if (!delivered) return { iso: nowIso, source: "now" };
  const stamped = (order.status_updated_at ?? "").trim();
  if (!stamped) return { iso: null, source: "unknown" };
  return { iso: stamped, source: "delivered" };
}
