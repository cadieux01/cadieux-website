// Pure helpers for the sandwich kitchen's operating window.
//
// Separated from `sandwich-kitchen.ts` (which does Supabase I/O) so these
// stay trivially testable and free of Node/Next imports. Everything here
// runs off a passed-in `SandwichKitchenState` — the reader is somebody
// else's job.
//
// All comparisons are IST wall-clock, matching how admin edits + stores
// the open/close values ("13:00", "23:00"). We do NOT round-trip through
// UTC: the customer's device clock is not authoritative, but the SERVER's
// UTC-to-IST offset is a fixed +05:30 and every reader here is server-side.

import type { SandwichKitchenState } from "./sandwich-kitchen";

/** Extract the current IST hour + minute as a single 0-1439 integer. */
export function istMinutesNow(now: Date = new Date()): number {
  // toLocaleString in en-GB with the Kolkata timezone yields "HH:mm:ss"
  // reliably (24-hour). Cheaper than pulling in a Temporal shim and does
  // not depend on the process TZ.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === "hour") h = Number(p.value);
    if (p.type === "minute") m = Number(p.value);
  }
  return h * 60 + m;
}

/** "13:00" → 780. Returns null for malformed input so callers can fall
 *  back to a safe default rather than crashing on a bad DB row. */
export function hhmmToMinutes(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** "13:00" → "1 PM". ":30" preserved. Matches how the kitchen banner
 *  reads: "Kitchen closed — opens 1 PM" for :00, "opens 1:30 PM" otherwise. */
export function formatHour12(hhmm: string): string {
  const mins = hhmmToMinutes(hhmm);
  if (mins === null) return hhmm; // pass through — better than a lie
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Is the kitchen currently accepting sandwich orders?
 *
 *  - `enabled=false` → always closed (master switch wins).
 *  - `open <= now < close` on the standard case.
 *  - Cross-midnight windows (close < open, e.g. 22:00–02:00) DO work
 *    because we split into two ranges — future-proof for a night menu
 *    even though the seed today is 13:00–23:00.
 *  - Malformed values fall back to the safe DEFAULTS (13:00–23:00) — a
 *    lookup that returned garbage must NEVER open the kitchen wider than
 *    the operator asked for.
 */
export function isKitchenOpenNow(
  state: SandwichKitchenState,
  now: Date = new Date(),
): boolean {
  if (!state.enabled) return false;
  const openM = hhmmToMinutes(state.open);
  const closeM = hhmmToMinutes(state.close);
  if (openM === null || closeM === null) return false;
  const cur = istMinutesNow(now);
  if (openM === closeM) return false; // zero-width window = closed
  if (openM < closeM) return cur >= openM && cur < closeM;
  // Cross-midnight: e.g. open=22:00, close=02:00.
  return cur >= openM || cur < closeM;
}
