// Legacy entry-point for one-off order delivery helpers. The canonical
// implementation lives in `delivery-slots.ts`; this file re-exports that
// unified API under the old names so existing callers (checkout page + API
// routes) compile unchanged.
//
// This header deliberately does NOT restate the slot universe, the booking
// lead, or which windows are bookable. It used to, and the copy rotted: it
// listed three bookable windows and kept listing them after two were paused,
// so the file whose entire job is to FORWARD to `delivery-slots.ts` ended up
// contradicting it. A re-export has no rules of its own to describe. Read
// `SLOTS`, `PAUSED_SLOTS` and `BOOKING_LEAD_MINUTES` in `delivery-slots.ts`,
// where the values are defined and so cannot disagree with themselves.
//
// What IS particular to this file, and is visible in the code below rather
// than asserted here: the exported names differ from the canonical ones, and
// `getOrderDeliveryDateOptions` narrows the full date list down to the two
// pills the legacy checkout UI was built around.
//
// New code should import from "@/lib/delivery-slots" directly.

import {
  SLOTS,
  isIsoDate,
  isValidSlotValue,
  dateHasAnyBookable,
  nextDeliveryDates,
  formatSlotForDisplay,
  todayIst,
} from "./delivery-slots";

/** The three canonical slot VALUES ("HH:MM-HH:MM"). Legacy alias — new
 *  code should import `SLOTS` from `@/lib/delivery-slots` directly. */
export const ORDER_DELIVERY_SLOTS: string[] = SLOTS.map((s) => s.value);

/** Pretty label for a stored slot value (canonical range or legacy). */
export function formatSlot12(slot: string): string {
  return formatSlotForDisplay(slot);
}

/** "Tomorrow" and "Day after" in IST — preserved for callers that still
 *  ask for exactly two date choices. The full date list lives in
 *  `nextDeliveryDates()` (today + future, 12h10m-aware). */
export function getOrderDeliveryDateOptions(): { tomorrow: string; dayAfter: string } {
  const dates = nextDeliveryDates(7);
  // First entry may be "today" if at least one same-day slot still
  // qualifies. To preserve legacy two-pill semantics we pick the first
  // entry that is strictly later than today, then the next one.
  const today = todayIst();
  const future = dates.filter((d) => d > today);
  return {
    tomorrow: future[0] ?? dates[1] ?? dates[0] ?? today,
    dayAfter: future[1] ?? future[0] ?? dates[1] ?? today,
  };
}

/** Returns true if `iso` is a yyyy-mm-dd that has at least one bookable
 *  slot from now (IST). Today is acceptable if a same-day slot still
 *  satisfies the 12 h rule; otherwise only future dates are accepted. */
export function isAcceptableDeliveryDate(iso: string): boolean {
  if (!isIsoDate(iso)) return false;
  // Don't accept anything strictly before IST-today.
  if (iso < todayIst()) return false;
  return dateHasAnyBookable(iso);
}

/** Returns true if `slot` is one of the three canonical slot values. */
export function isAcceptableDeliverySlot(slot: string): boolean {
  return isValidSlotValue(slot);
}

/** Pretty label for a delivery date, e.g. "Tue, 19 May 2026". */
export function formatDeliveryDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
