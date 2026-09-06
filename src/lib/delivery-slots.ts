// Unified delivery-slot lib for ONE-OFF orders AND subscriptions.
//
// ONE SOURCE OF TRUTH for:
//   - the slot universe (3 fixed windows: Morning / Midday / Evening)
//   - the 6 h BOOKING cutoff (placement), measured to the slot's START
//   - the 14 h SELF-EDIT cutoff (customer-driven date/slot change)
//   - the ADMIN_PHONE message shown to customers within 14 h
//   - IST (Asia/Kolkata) date math regardless of server clock
//
// The three windows are:
//   - "06:00-10:00"  Morning  6 AM – 10 AM
//   - "10:00-14:00"  Midday   10 AM – 2 PM
//   - "16:00-21:00"  Evening  4 PM – 9 PM
// Nothing 2 PM – 4 PM. Nothing after 9 PM. Those gaps are deliberate.
//
// Consumers (intentionally many):
//   - One-off checkout    (web /api/checkout, mobile /api/mobile/checkout, /checkout page)
//   - Subscription setup  (web /api/subscriptions, mobile /api/mobile/subscriptions, /subscriptions/setup)
//   - Self-edit endpoints (.../subscriptions/[id]/deliveries/[deliveryId]/edit)
//   - Admin override path (no client gating — admin bypasses both rules)
//
// Storage format for NEW writes:
//   - Slots stored as "HH:MM-HH:MM" (start-end); exactly one of the three
//     canonical range strings above. `isValidSlotValue` rejects anything else.
//   - Dates stored as IST "yyyy-mm-dd".
//
// Legacy compatibility (READ-ONLY — no rows are ever rewritten):
//   - Older orders / subscription deliveries may hold a bare "HH:MM"
//     (e.g. "07:30") from the old 30-minute grid, or an old range
//     like "06:00-07:00". `formatSlotForDisplay` renders both shapes
//     sensibly so admin views + customer history remain legible.
//   - The 6 h server gate reads the START in either shape, so
//     legacy values still validate for the (rare) admin re-book path.

// ── Tunables ────────────────────────────────────────────────────────────

/** Booking lead time: 6 hours. New orders/subscriptions can't book a slot
 *  whose START is within this window from "now" (IST). */
export const BOOKING_LEAD_MINUTES = 360;

/** Self-edit cutoff: if the delivery slot starts ≤ 14 h from now, the
 *  customer cannot self-edit and must call ADMIN_PHONE. */
export const SELF_EDIT_CUTOFF_MINUTES = 840;

/** Customer-facing number for sub-cutoff edits. */
export const ADMIN_PHONE = "+91 99891 53747";

/** Human-readable timezone used in calculations. */
export const IST_TZ = "Asia/Kolkata";

// ── Types ───────────────────────────────────────────────────────────────

export type Slot = {
  /** Stored value: "HH:MM-HH:MM" (start-end). One of the three canonical
   *  range strings — this is what goes into the DB. */
  value: string;
  /** Period name: "Morning" | "Midday" | "Evening". */
  label: string;
  /** Slot start "HH:MM" (24h). Used for the 6 h / 14 h math. */
  startValue: string;
  /** Slot end "HH:MM" (24h). Same 24h clock as startValue. */
  endValue: string;
  /** Combined display, e.g. "Morning · 6 – 10 AM". */
  rangeLabel: string;
};

export type BookableSlot = Slot & {
  /** False when the slot start is < 6 h from now; UI greys disabled slots.
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

/** Extract the start "HH:MM" from any accepted slot shape:
 *    - New range "HH:MM-HH:MM"       → the left "HH:MM"
 *    - Legacy single "HH:MM"         → itself
 *  Returns null if the shape is unrecognised. */
function extractStartHHMM(slotValue: string): string | null {
  const range = /^(\d{2}:\d{2})-\d{2}:\d{2}$/.exec(slotValue);
  if (range) return range[1];
  if (/^\d{2}:\d{2}$/.test(slotValue)) return slotValue;
  return null;
}

/** Pretty 12-hour clock label for a single "HH:MM" point.
 *  Strips ":00" for brevity (e.g. "08:00" → "8 AM", "07:30" → "7:30 AM"). */
function fmt12(hhmm: string): string {
  const p = parseHHMM(hhmm);
  if (!p) return hhmm;
  const ampm = p.hour < 12 ? "AM" : "PM";
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const mm = p.minute === 0 ? "" : `:${pad2(p.minute)}`;
  return `${h12}${mm} ${ampm}`;
}

/** Like fmt12, but ALWAYS shows ":MM" — used inside fmtRange so a slot
 *  ending on the hour reads "8:00 AM" rather than "8 AM". */
function fmt12Full(hhmm: string): string {
  const p = parseHHMM(hhmm);
  if (!p) return hhmm;
  const ampm = p.hour < 12 ? "AM" : "PM";
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${pad2(p.minute)} ${ampm}`;
}

/** Pretty range label using a compact en-dash (no surrounding spaces),
 *  collapsing AM/PM on the start side when start and end share a period.
 *  Examples: "7:30–8:00 AM", "12:30–1:00 PM", "8:30–9:00 PM". Used ONLY
 *  for legacy (non-canonical) values so history rows stay legible. */
function fmtRange(start: string, end: string): string {
  const ps = parseHHMM(start);
  const pe = parseHHMM(end);
  if (!ps || !pe) return `${start}–${end}`;
  const startPeriod = ps.hour < 12 ? "AM" : "PM";
  const endPeriod = pe.hour < 12 ? "AM" : "PM";
  const startBare = fmt12Full(start).replace(/ (AM|PM)$/, "");
  if (startPeriod === endPeriod) return `${startBare}–${fmt12Full(end)}`;
  return `${fmt12Full(start)}–${fmt12Full(end)}`;
}

// ── The three fixed slots ───────────────────────────────────────────────

/** The ONLY slots valid for new writes. Order = display order in pickers. */
export const SLOTS: Slot[] = [
  {
    value: "06:00-10:00",
    label: "Morning",
    startValue: "06:00",
    endValue: "10:00",
    rangeLabel: "Morning · 6 – 10 AM",
  },
  {
    value: "10:00-14:00",
    label: "Midday",
    startValue: "10:00",
    endValue: "14:00",
    rangeLabel: "Midday · 10 AM – 2 PM",
  },
  {
    value: "16:00-21:00",
    label: "Evening",
    startValue: "16:00",
    endValue: "21:00",
    rangeLabel: "Evening · 4 – 9 PM",
  },
];

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

/** Absolute millis of an IST date + slot START. Accepts either the new
 *  "HH:MM-HH:MM" range values or legacy single "HH:MM" values (so the
 *  gate still evaluates correctly if an admin re-books an old row).
 *  Computed via Asia/Kolkata's fixed +5:30 offset (no DST). */
export function slotStartUtcMs(dateIso: string, slotValue: string): number | null {
  if (!isIsoDate(dateIso)) return null;
  const startHHMM = extractStartHHMM(slotValue);
  if (!startHHMM) return null;
  const p = parseHHMM(startHHMM);
  if (!p) return null;
  const [y, m, d] = dateIso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const wallUtc = Date.UTC(y, m - 1, d, p.hour, p.minute, 0, 0);
  return wallUtc - IST_OFFSET_MS;
}

// ── Booking (6 h) rule ──────────────────────────────────────────────────

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
 *  slot still satisfies the 6 h rule). Dates with zero bookable
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
  // No slot stored yet → treat as the start of the earliest window
  // (Morning) so the customer at least gets the benefit of the doubt.
  const effectiveSlot = slotValue && extractStartHHMM(slotValue) ? slotValue : SLOTS[0].value;
  const startMs = slotStartUtcMs(dateIso, effectiveSlot);
  if (startMs == null) return false;
  const cutoffMs = SELF_EDIT_CUTOFF_MINUTES * 60 * 1000;
  return startMs - now.getTime() > cutoffMs;
}

/** Friendly "call us" message used when a customer is inside the 14 h cutoff. */
export const SELF_EDIT_BLOCKED_MESSAGE = `To change a delivery within 14 hours, please call us at ${ADMIN_PHONE}.`;

// ── Validation (server-side source of truth) ────────────────────────────

/** True iff `value` matches one of the three canonical range strings.
 *  Legacy "HH:MM" values return FALSE — we never accept them on new writes. */
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
      error: "That delivery slot is too soon — orders need 6 hours to bake and ship.",
      code: "slot_too_soon",
    };
  }
  return null;
}

// ── Display helpers ─────────────────────────────────────────────────────

/** Pretty label for ANY stored slot value. Priority:
 *    1. Canonical range ("06:00-10:00" …) → the SLOT's rangeLabel
 *       ("Morning · 6 – 10 AM").
 *    2. Legacy range "HH:MM-HH:MM"        → fmtRange(start, end).
 *    3. Legacy single "HH:MM"             → 30-min window (start → +30 min).
 *    4. Anything else                     → the raw value (defensive). */
export function formatSlotForDisplay(value: string | null | undefined): string {
  if (!value) return "";
  const canonical = SLOTS.find((s) => s.value === value);
  if (canonical) return canonical.rangeLabel;
  const rangeM = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(value);
  if (rangeM) return fmtRange(rangeM[1], rangeM[2]);
  const p = parseHHMM(value);
  if (p) {
    const endMins = (p.hour * 60 + p.minute + 30) % (24 * 60);
    const eh = Math.floor(endMins / 60);
    const em = endMins % 60;
    const endValue = `${pad2(eh)}:${pad2(em)}`;
    return fmtRange(value, endValue);
  }
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
