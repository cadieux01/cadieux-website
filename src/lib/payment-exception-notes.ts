// public.payment_exceptions.resolved_note — one column, many entries.
//
// APPEND, NEVER OVERWRITE. A resolution can turn out to be wrong: the refund
// went against the other duplicate row, the payment was found on a different
// order, the customer was already called. If the correction goes anywhere else
// — a note on the order, a message in a thread — then whoever opens this
// exception row next month reads a wrong resolution with no sign it was ever
// corrected, while the correction sits somewhere they have no reason to open.
// That is the stale-comment failure in a new costume. So the record of what was
// decided, INCLUDING the part that was wrong, stays where the next reader is
// already looking.
//
// Consequences of that, all deliberate:
//   • there is no edit and no delete — a correction is another entry;
//   • there is no un-resolve — `resolved_at` records when the row left the
//     worklist, and a later correction does not un-make that decision, so it is
//     stamped once and never re-stamped;
//   • every entry carries its own IST timestamp, because the sequence is the
//     only thing that tells a reader which line superseded which.

export const EXCEPTION_NOTE_MAX = 1000;

/** Trim + length-check one entry. Resolving REQUIRES a note: a row closed with
 *  no reason is indistinguishable from the silent ack this whole table was
 *  built to stop. */
export function validateExceptionNote(
  raw: unknown,
): { note: string } | { error: string } {
  if (typeof raw !== "string") return { error: "A note is required." };
  const note = raw.trim();
  if (note.length === 0) return { error: "A note is required." };
  if (note.length > EXCEPTION_NOTE_MAX) {
    return { error: `Note must be ${EXCEPTION_NOTE_MAX} characters or fewer.` };
  }
  return { note };
}

/**
 * "2026-10-01 14:44 IST" — the stamp that opens every entry.
 *
 * Digits and an explicit zone, not the prose `formatDateTime` renders
 * elsewhere in the admin, for two reasons: this trail is a record read in
 * sequence, where a sortable stamp is easier to scan than "1 Oct 2026, 02:44
 * pm"; and the zone is spelled out because a resolution is compared against
 * timestamps in the Razorpay dashboard, which shows IST, and against
 * `received_at`, which is UTC in the database. Keeping it dependency-free is
 * also what lets scripts/exception-note-check.ts import this module directly.
 */
function istStamp(at: Date): string {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => p.find((x) => x.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} IST`;
}

/**
 * The stored value after adding one entry. Pure — the caller owns the write,
 * and owns detecting that `existing` changed underneath it.
 *
 * Entries are separated by a blank line so a multi-line note stays readable as
 * one entry rather than dissolving into the trail around it.
 */
export function appendResolvedNote(
  existing: string | null,
  entry: string,
  at: Date,
): string {
  const stamped = `${istStamp(at)} — ${entry}`;
  const prior = (existing ?? "").trim();
  return prior.length === 0 ? stamped : `${prior}\n\n${stamped}`;
}
