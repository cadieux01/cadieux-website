// The Call-update dropdown's vocabulary and its timestamp format.
//
// WHY THIS IS A MODULE. Both boards grew the same four presets and the same
// IST formatter independently, as two literal copies. That is a slow leak
// rather than a bug: the day someone adds "Wrong number" to the orders list,
// the subscriptions list keeps four options and nobody notices, because
// neither copy is wrong on its own — they are only wrong about each other.
//
// The presets are the operator's SPOKEN vocabulary, not a status. Selecting
// one POSTs a note with kind='call' whose body is the label verbatim, so the
// strings below are stored in the database and read back by humans. Editing
// one does not migrate the notes already written with the old wording; add a
// new preset instead of rewording an existing one.

import { istDateParts } from "@/lib/admin-formatting";
import { MONTH_SHORT } from "@/lib/date-names";

/** Presets on the Call-update dropdown, in menu order. The custom escape
 *  hatch is not listed here — it opens the NotePanel with kind pre-set to
 *  'call' so the operator types free-form. */
export const CALL_PRESETS = [
  "Confirmed on call",
  "Did not lift the call",
  "Call back later",
  "Customer asked to reschedule",
] as const;

export type CallPreset = (typeof CALL_PRESETS)[number];

/**
 * The inline last-call chip's timestamp.
 *
 * Fixed to Asia/Kolkata so every operator sees the same wall-clock
 * regardless of device timezone — two people reading "4:15 PM" off the same
 * row have to mean the same minute, or "I called her at four" stops being a
 * usable sentence.
 *
 * Returns the raw ISO string if the date will not parse. A visibly wrong
 * timestamp is better than a thrown render.
 */
export function formatCallChipTime(iso: string): string {
  try {
    const d = new Date(iso);
    const { day, month } = istDateParts(d);
    const time = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
    // Month spelled from MONTH_SHORT, not Intl month:"short", which renders
    // September as "Sept" on current ICU.
    return `${String(day).padStart(2, "0")} ${MONTH_SHORT[month - 1]}, ${time}`;
  } catch {
    return iso;
  }
}
