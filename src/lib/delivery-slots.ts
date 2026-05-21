// Unified delivery-slot lib for ONE-OFF orders AND subscriptions.
//
// One source of truth for:
//   - the slot universe (7:30 AM – 9:00 PM, every 30 min)
//   - the 12 h 10 m BOOKING cutoff (placement)
//   - the 14 h SELF-EDIT cutoff (customer-driven date/slot change)
//   - the ADMIN_PHONE message shown to customers within 14 h
//   - IST (Asia/Kolkata) date math regardless of server clock
//
// Consumers (intentionally many):
//   - One-off checkout    (web /api/checkout, mobile /api/mobile/checkout, /checkout page)
//   - Subscription setup  (web /api/subscriptions, mobile /api/mobile/subscriptions, /subscriptions/setup)
//   - Self-edit endpoints (.../subscriptions/[id]/deliveries/[deliveryId]/edit)
//   - Admin override path (no client gating — admin bypasses both rules)
//
// Storage format:
//   - Slots are stored as 24-hour "HH:MM" (e.g. "07:30").
//   - Dates are stored as IST "yyyy-mm-dd".
//
// Legacy compatibility:
//   - Older subscription deliveries used "HH:MM-HH:MM" (e.g. "06:00-07:00").
//   - `formatSlotForDisplay()` accepts both shapes so legacy rows render.
//   - Server-side validators (isValidSlotValue) only accept the new shape
//     for *new writes* — we never rewrite old rows in place.

// ── Tunables ────────────────────────────────────────────────────────────

/** "HH:MM" of the first bookable slot start. */
export const SLOT_START = "07:30";
/** "HH:MM" of the last bookable slot start (window is 21:00 → 21:30). */
export const SLOT_END = "21:00";
/** Slot granularity in minutes. */
export const SLOT_INTERVAL_MIN = 30;

/** Booking lead time: 12 hours 10 minutes. New orders/subscriptions can't
 *  book a slot that starts within this window from "now" (IST). */
export const BOOKING_LEAD_MINUTES = 730;

/** Self-edit cutoff: if the delivery slot is ≤ 14 h away, the customer
 *  cannot self-edit and must call ADMIN_PHONE. */
export const SELF_EDIT_CUTOFF_MINUTES = 840;

/** Customer-facing number for sub-cutoff edits. */
export const ADMIN_PHONE = "+91-7093403747";

/** Human-readable timezone used in calculations. */
export const IST_TZ = "Asia/Kolkata";

// ── Types ───────────────────────────────────────────────────────────────

export type Slot = {
  /** 24-hour start time, e.g. "07:30". This is the stored value. */
  value: string;
  /** Pretty 12-hour label, e.g. "7:30 AM". */
  label: string;
  /** 24-hour end time, e.g. "08:00" (start + SLOT_INTERVAL_MIN). */
  endValue: string;
  /** Pretty 12-hour range label, e.g. "7:30 – 8:00 AM". */
  rangeLabel: string;
};

export type BookableSlot = Slot & {
  /** False when the slot is ≥ 12h10m from now; UI greys disabled slots.
   *  Server-side validation re-checks this regardless of client state. */
  disabled: boolean;
};

// ── Internal helpers ────────────────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Parse "HH:MM" → { hour, minute }; returns null on garbage. */
function parseHHMM(hhmm: string): { hour: number; minute: number } | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** Pretty 12-hour clock label for a single "HH:MM" point. e.g. "07:30" → "7:30 AM". */
function fmt12(hhmm: string): string {
  const p = parseHHMM(hhmm);
  if (!p) return hhmm;
  const ampm = p.hour < 12 ? "AM" : "PM";
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const mm = p.minute === 0 ? "" : `:${pad2(p.minute)}`;
  return `${h12}${mm} ${ampm}`;
}

/** Pretty range label, collapsing AM/PM on the start side when shared. */
function fmtRange(start: string, end: string): string {
  const ps = parseHHMM(start);
  const pe = parseHHMM(end);
  if (!ps || !pe) return `${start} – ${end}`;
  const startPeriod = ps.hour < 12 ? "AM" : "PM";
  const endPeriod = pe.hour < 12 ? "AM" : "PM";
  const startBare = fmt12(start).replace(/ (AM|PM)$/, "");
  if (startPeriod === endPeriod) return `${startBare} – ${fmt12(end)}`;
  return `${fmt12(start)} – ${fmt12(end)}`;
}

// ── Slot generation ─────────────────────────────────────────────────────

/** All bookable slot starts from SLOT_START to SLOT_END inclusive, stepping
 *  by SLOT_INTERVAL_MIN. Memoised at module load. */
export const SLOTS: Slot[] = (() => {
  const startP = parseHHMM(SLOT_START);
  const endP = parseHHMM(SLOT_END);
  if (!startP || !endP) return [];
  const startMins = startP.hour * 60 + startP.minute;
  const endMins = endP.hour * 60 + endP.minute;
  const out: Slot[] = [];
  for (let m = startMins; m <= endMins; m += SLOT_INTERVAL_MIN) {
    const sh = Math.floor(m / 60);
    const sm = m % 60;
    const value = `${pad2(sh)}:${pad2(sm)}`;
    const endM = m + SLOT_INTERVAL_MIN;
    const eh = Math.floor(endM / 60);
    const em = endM % 60;
    const endValue = `${pad2(eh % 24)}:${pad2(em)}`;
    out.push({
      value,
      endValue,
      label: fmt12(value),
      rangeLabel: fmtRange(value, endValue),
    });
  }
  return out;
})();

/** Returns the full slot list (alias for SLOTS). */
export function generateSlots(): Slot[] {
  return SLOTS;
}

// ── IST date primitives ─────────────────────────────────────────────────

/** "yyyy-mm-dd" in IST regardless of host TZ. */
export function istIsoDate(d: Date = new Date()): string {
  // en-CA produces ISO yyyy-mm-dd directly.
  return d.toLocaleDateString("en-CA", { timeZone: IST_TZ });
}

/** Today (IST), yyyy-mm-dd. */
export function todayIst(now: Date = new Date()): string {
  return istIsoDate(now);
}

/** Returns true if the string matches yyyy-mm-dd. */
export function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Absolute millis of an IST date + slot start. Computed via
 *  Asia/Kolkata-local fields → UTC, so callers can compare with
 *  Date.now() (UTC ms) regardless of server clock. */
export function slotStartUtcMs(dateIso: string, slotValue: string): number | null {
  if (!isIsoDate(dateIso)) return null;
  const p = parseHHMM(slotValue);
  if (!p) return null;
  const [y, m, d] = dateIso.split("-").map(Number);
  if (!y || !m || !d) return null;
  // IST is fixed UTC+5:30 (no DST). Compose UTC ms from IST wall-clock.
  // wallTime (UTC) - IST_OFFSET = real UTC.
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const wallUtc = Date.UTC(y, m - 1, d, p.hour, p.minute, 0, 0);
  return wallUtc - IST_OFFSET_MS;
}

// ── Booking (12h10m) rule ───────────────────────────────────────────────

/** True if `slot` on `date` starts ≥ BOOKING_LEAD_MINUTES from `now`. */
export function isBookable(
  dateIso: string,
  slotValue: string,
  now: Date = new Date(),
): boolean {
  const startMs = slotStartUtcMs(dateIso, slotValue);
  if (startMs == null) return false;
  const leadMs = BOOKING_LEAD_MINUTES * 60 * 1000;
  return startMs - now.getTime() >= leadMs;
}

/** All slots for `date` annotated with `disabled` per the booking rule. */
export function bookableSlots(
  dateIso: string,
  now: Date = new Date(),
): BookableSlot[] {
  return SLOTS.map((s) => ({
    ...s,
    disabled: !isBookable(dateIso, s.value, now),
  }));
}

/** True iff `date` has at least one bookable slot from `now`. */
export function dateHasAnyBookable(
  dateIso: string,
  now: Date = new Date(),
): boolean {
  return SLOTS.some((s) => isBookable(dateIso, s.value, now));
}

/** Returns the next N candidate delivery dates (IST), starting from
 *  today (so the picker can show "Today" when at least one same-day
 *  slot still satisfies the 12h10m rule). Dates with zero bookable
 *  slots are EXCLUDED so the UI never shows a dead date pill.
 *  N defaults to 7 — one week of options. */
export function nextDeliveryDates(
  n: number = 7,
  now: Date = new Date(),
): string[] {
  const out: string[] = [];
  const todayIso = todayIst(now);
  const [y, m, d] = todayIso.split("-").map(Number);
  for (let i = 0; i < n + 7 && out.length < n; i++) {
    // Build a wall-clock date `i` days after IST-today.
    const future = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + i));
    const iso = future.toISOString().slice(0, 10);
    if (dateHasAnyBookable(iso, now)) out.push(iso);
  }
  return out;
}

/** First slot value on `dateIso` that satisfies the booking rule, or null. */
export function firstBookableSlot(
  dateIso: string,
  now: Date = new Date(),
): string | null {
  const found = SLOTS.find((s) => isBookable(dateIso, s.value, now));
  return found ? found.value : null;
}

// ── Self-edit (14h) rule ────────────────────────────────────────────────

/** True iff the customer is still allowed to self-edit the delivery
 *  (date+slot) without admin intervention. */
export function canSelfEdit(
  dateIso: string,
  slotValue: string | null,
  now: Date = new Date(),
): boolean {
  // No slot stored yet → treat as the start of the day; still allow if
  // the *start of the date* is > 14h away. Defensive — in practice every
  // subscription delivery has a slot.
  const effectiveSlot = slotValue && parseHHMM(slotValue) ? slotValue : SLOT_START;
  const startMs = slotStartUtcMs(dateIso, effectiveSlot);
  if (startMs == null) return false;
  const cutoffMs = SELF_EDIT_CUTOFF_MINUTES * 60 * 1000;
  return startMs - now.getTime() > cutoffMs;
}

/** Friendly "call us" message used when a customer is inside the 14 h cutoff. */
export const SELF_EDIT_BLOCKED_MESSAGE = `To change a delivery within 14 hours, please call us at ${ADMIN_PHONE}.`;

// ── Validation (server-side source of truth) ────────────────────────────

/** True iff `value` matches one of the canonical "HH:MM" slots. */
export function isValidSlotValue(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return SLOTS.some((s) => s.value === value);
}

/** Server-side "slot_too_soon" gate. Returns null on success, or an error
 *  object with a stable code for the client to switch on. */
export function validateBookingSlot(
  dateIso: unknown,
  slotValue: unknown,
  now: Date = new Date(),
):
  | null
  | { status: number; error: string; code: string } {
  if (!isIsoDate(dateIso)) {
    return { status: 400, error: "Invalid delivery date.", code: "bad_date" };
  }
  if (!isValidSlotValue(slotValue)) {
    return { status: 400, error: "Invalid delivery slot.", code: "bad_slot" };
  }
  if (!isBookable(dateIso, slotValue, now)) {
    return {
      status: 400,
      error: "That delivery slot is too soon — orders need 12 h 10 m to bake and ship.",
      code: "slot_too_soon",
    };
  }
  return null;
}

// ── Display helpers ─────────────────────────────────────────────────────

/** Pretty label for ANY stored slot value:
 *    - New "HH:MM" → "7:30 AM"
 *    - Legacy "HH:MM-HH:MM" → "6 – 7 AM"  (preserved for legacy rows) */
export function formatSlotForDisplay(value: string | null | undefined): string {
  if (!value) return "";
  // Legacy "HH:MM-HH:MM"
  const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(value);
  if (m) return fmtRange(m[1], m[2]);
  // New "HH:MM"
  if (parseHHMM(value)) return fmt12(value);
  return value;
}

/** Friendly date label: "Today", "Tomorrow", or "Mon, 23 May". IST-aware. */
export function dateLabel(dateIso: string, now: Date = new Date()): string {
  const today = todayIst(now);
  const [y, m, d] = today.split("-").map(Number);
  const tomorrowUtc = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + 1));
  const tomorrowIso = tomorrowUtc.toISOString().slice(0, 10);
  if (dateIso === today) return "Today";
  if (dateIso === tomorrowIso) return "Tomorrow";
  const [yy, mm, dd] = dateIso.split("-").map(Number);
  if (!yy || !mm || !dd) return dateIso;
  const dt = new Date(Date.UTC(yy, mm - 1, dd));
  return dt.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
