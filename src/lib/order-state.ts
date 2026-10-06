// Order-state classifier — computed (not stored). Mirror of the WhatsApp
// bot's classifyOrder so every surface (customer tracker, admin, mobile
// API responses) presents the SAME truth about a live vs stale order.
//
// SOURCE OF TRUTH: supabase/functions/whatsapp-ai-reply/index.ts
//   (see classifyOrder — lines ~423-457, constant SEVEN_DAYS_MS)
// If you change the rule here, change it there too — and vice versa.
//
// Contract:
//   • Pure function. Input: an order row with { status, payment_status,
//     created_at }. Output: one of the 5 OrderState strings below.
//   • Nothing is written back to the DB. Expiry is derived on read.
//   • Safe to call from client OR server (no imports, no env access).
//
// Precedence (highest first) — mirrored verbatim from the bot:
//   1. status=='delivered'  → 'delivered'  (terminal)
//   2. status=='cancelled'  → 'cancelled'  (terminal)
//   3. payment_status=='paid' OR advanced status
//        (confirmed | preparing | out_for_delivery | dispatched)
//                            → 'active'
//   4. status ∈ {pending, placed} AND unpaid:
//        • unparseable created_at → 'expired' (conservative)
//        • age > 7×24h (strict >) → 'expired'
//        • else                    → 'pending'
//   5. anything else (unknown status) → 'active' (permissive default)
//
// Boundary: exactly 7 days old still counts as within-window → 'pending'.

export type OrderState =
  | "delivered"
  | "cancelled"
  | "active"
  | "pending"
  | "expired";

// Keep in lock-step with whatsapp-ai-reply/index.ts SEVEN_DAYS_MS.
export const ORDER_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// Statuses that mean "team has already picked it up / moved it along".
const ADVANCED_STATUSES = new Set([
  "confirmed",
  "preparing",
  "out_for_delivery",
  "dispatched",
]);

// Statuses that mean "placed but not yet acted on by the team".
const PENDINGISH_STATUSES = new Set(["pending", "placed"]);

// Minimal input shape — extra fields on the caller's order are ignored.
export type OrderStateInput = {
  status?: string | null;
  payment_status?: string | null;
  created_at?: string | null;
};

export function computeOrderState(
  order: OrderStateInput,
  nowMs: number = Date.now(),
): OrderState {
  const status = (order.status ?? "").toLowerCase();
  if (status === "delivered") return "delivered";
  if (status === "cancelled") return "cancelled";

  const paid = (order.payment_status ?? "").toLowerCase() === "paid";
  if (paid || ADVANCED_STATUSES.has(status)) return "active";

  if (PENDINGISH_STATUSES.has(status)) {
    const createdMs = order.created_at ? Date.parse(order.created_at) : NaN;
    // Unparseable date → be conservative: never claim it's a live delivery.
    //
    // CAUTION FOR ANYONE FEEDING THIS FUNCTION BY HAND. That conservative answer
    // is indistinguishable from a genuinely expired order: both come back
    // "expired", with no throw and no log. So a date-handling bug in a caller
    // looks exactly like a real result. It cost a 13x undercount once.
    //
    // THERE IS NO PRODUCTION BUG HERE TO FIND — do not go hunting for one. Every
    // caller in the app reaches this function through supabase-js, and PostgREST
    // serialises timestamps as `2026-10-04T06:12:33.91+00:00`, which parses. The
    // only other way in is a NULL created_at, and prod has 0 of those across all
    // 675 orders (the column is nullable, defaulted `now()`, so this is a measured
    // fact rather than a guarantee — but no real row reaches this line today).
    //
    // The hazard is OUR OWN verification code, and the blame does not sit with
    // Postgres: the shape that bites is one a harness CREATES by half-normalising a
    // string that already worked. Measured on node v25.8.2:
    //
    //   "2026-10-04 06:12:33.91+00"     → PARSES   (psql/MCP raw output is fine;
    //                                               V8's lenient non-ISO path
    //                                               accepts a 2-digit offset)
    //   "2026-10-04T06:12:33.91+00"     → NaN      (adding `T` demands strict
    //                                               ISO-8601, where the offset
    //                                               must be ±HH:MM or Z)
    //   "2026-10-04 06:12:33.91"        → PARSES AS LOCAL TIME — silently shifts
    //                                     by the machine's offset (5.5 h on IST)
    //
    // So the bug is the HALF-NORMALISATION: `.replace(" ", "T")` turns a working
    // string into NaN, and stripping the offset instead turns it into the wrong
    // instant. Convert the offset too (`+00` → `Z`) or leave the string alone, and
    // assert `Number.isFinite(Date.parse(x))` before trusting any answer.
    // scripts/abandonable-check.ts pins all three and exits non-zero.
    if (!Number.isFinite(createdMs)) return "expired";
    const ageMs = nowMs - createdMs;
    return ageMs > ORDER_EXPIRY_MS ? "expired" : "pending";
  }

  return "active";
}

/** Convenience: true iff computeOrderState(order) === 'expired'. */
export function isExpiredOrder(
  order: OrderStateInput,
  nowMs: number = Date.now(),
): boolean {
  return computeOrderState(order, nowMs) === "expired";
}
