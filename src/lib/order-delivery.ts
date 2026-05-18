// Helpers for one-shot order delivery date/slot selection.
//
// We offer two date choices — tomorrow (IST) and the day after — and
// 14 one-hour slots from 06:00 to 19:00. Slots are stored as single
// hour-strings ("06:00".."19:00") so they're trivially comparable;
// `formatSlot12` renders the customer-facing 12-hour label.
//
// IMPORTANT: dates are always computed in Asia/Kolkata regardless of
// the server clock, so a Vercel function running in any region still
// shows the same "tomorrow" as our customers see.

/** Single-hour slots: "06:00" .. "19:00" (14 entries). */
export const ORDER_DELIVERY_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = 6; h <= 19; h++) {
    out.push(`${String(h).padStart(2, "0")}:00`);
  }
  return out;
})();

/** Pretty 12-hour label, e.g. "06:00" → "6:00 AM". */
export function formatSlot12(slot: string): string {
  const h = parseInt(slot.slice(0, 2), 10);
  if (Number.isNaN(h)) return slot;
  const ampm = h < 12 ? "AM" : "PM";
  const hh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hh}:00 ${ampm}`;
}

/** Returns "yyyy-mm-dd" in Asia/Kolkata regardless of server TZ. */
function istIsoDate(d: Date): string {
  // en-CA produces ISO yyyy-mm-dd directly.
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Returns today's date (in IST) as a midnight-anchored Date. */
function istNow(): Date {
  return new Date();
}

/** "Tomorrow" and "Day after" in IST, ISO yyyy-mm-dd. */
export function getOrderDeliveryDateOptions(): { tomorrow: string; dayAfter: string } {
  const now = istNow();
  // Build a Date that represents IST midnight today by reading the
  // IST date and adding 1 / 2 calendar days.
  const todayIso = istIsoDate(now); // yyyy-mm-dd in IST
  const [y, m, d] = todayIso.split("-").map((s) => parseInt(s, 10));
  const base = new Date(Date.UTC(y, m - 1, d));
  const tomorrow = new Date(base);
  tomorrow.setUTCDate(base.getUTCDate() + 1);
  const dayAfter = new Date(base);
  dayAfter.setUTCDate(base.getUTCDate() + 2);
  return {
    tomorrow: tomorrow.toISOString().slice(0, 10),
    dayAfter: dayAfter.toISOString().slice(0, 10),
  };
}

/** Returns true if `iso` is one of the two acceptable delivery dates. */
export function isAcceptableDeliveryDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const { tomorrow, dayAfter } = getOrderDeliveryDateOptions();
  return iso === tomorrow || iso === dayAfter;
}

/** Returns true if `slot` is one of the 14 hour-strings. */
export function isAcceptableDeliverySlot(slot: string): boolean {
  return ORDER_DELIVERY_SLOTS.includes(slot);
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
