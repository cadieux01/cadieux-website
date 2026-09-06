// Legacy entry-point for one-off order delivery helpers. The canonical
// implementation now lives in `delivery-slots.ts` — this file re-exports
// the unified API under the old names so callers (checkout page + API
// routes) compile unchanged while the new rules take effect:
//
//   - 3 fixed windows: Morning (6–10 AM), Midday (10 AM–2 PM), Evening (4–9 PM)
//   - 6 h booking lead (measured to the slot's START), IST-aware
//   - "today + future" date list (was tomorrow / day-after only)
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
 *  satisfies the 6 h rule; otherwise only future dates are accepted. */
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
