// "New Update" — somebody on the team wrote something since the status was
// last set.
//
// THE TRIGGER IS A COMPARISON, NOT AN EXISTENCE CHECK. "This order has a
// note" is the wrong rule and is worth spelling out because it is the
// obvious one to reach for: the note never goes away, so an order flagged
// that way can never be moved off the flag. An operator sets it to
// Delivered, the note is still sitting there, and it reads New Update
// again on the next render. The flag would be unclearable, and an
// unclearable flag is noise within a day.
//
// So the question is "was the note written AFTER the status was set", which
// makes the loop close by itself:
//
//   note arrives           → note.created_at > status_updated_at → New Update
//   operator sets Delivered → status_updated_at = now()          → Delivered
//   next note arrives      → created_at > that stamp             → New Update
//
// Setting the status to the value it already holds is a legitimate move
// here, not a no-op: PATCH /api/admin/orders/[id] stamps status_updated_at
// unconditionally, so "acknowledge this and leave it Delivered" is just
// picking Delivered again.
//
// WHICH NOTES COUNT: kind='note' ONLY. Not 'edit', not 'call'.
//   • 'edit' rows are written by the admin_edit_order RPC itself — the
//     customer-visible "delivery moved to Thursday" trail and the internal
//     "REFUND DUE ₹X" bookkeeping. They are the system talking to itself.
//     If every admin edit flipped the order to New Update the signal would
//     be worthless by the end of the first busy day.
//   • 'call' rows already have their own signal: the contact buttons on
//     the row change once a call is logged. A second indicator for the
//     same fact churns the status column and tells the operator nothing
//     new. If calls should flip it too that is a later decision and a
//     one-line change here — add "call" to the kinds the aggregate folds
//     into last_team_note.
//
// NO IMPORTS, ON PURPOSE. Both the status vocabulary (admin-shared.ts) and
// the filter predicate (order-filter.ts) need this, and the board, the
// print view and the run sheet all read it. A module with no edges cannot
// introduce a cycle between those, and `node --test` can load it directly.

/** The computed status value. NOT a stored `orders.status` — nothing ever
 *  writes this string to the database, the same way `expired` is never
 *  written (see src/lib/order-state.ts). */
export const NEW_UPDATE_STATUS = "new_update";

/** The two fields the rule reads. Both optional and structural so the
 *  board row, the print view's leaner row and a test fixture all satisfy
 *  it without a cast. */
export type NewUpdateFacts = {
  /** Stamped by PATCH /api/admin/orders/[id] and the bulk route on every
   *  status write. */
  status_updated_at?: string | null;
  /** Newest kind='note' row for this order — see aggregateNotesFor in
   *  src/lib/order-notes.ts. Null when the team has written none. */
  last_team_note?: { created_at: string } | null;
};

function msOrNull(iso: string | null | undefined): number | null {
  if (typeof iso !== "string" || iso.trim() === "") return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * True iff a team note was written strictly after the status was last set.
 *
 * STRICTLY after. Equal timestamps mean the status was set at least as
 * recently as the note, so there is nothing newer to read.
 *
 * A MISSING status_updated_at FAILS OPEN — a note with no stamp to compare
 * against shows as New Update. The column carries `default now()` and was
 * backfilled from created_at (sql/order-status-stages.sql), so null is very
 * nearly unreachable; if it happens, the honest answer is "somebody wrote
 * something and we cannot prove it has been read". Failing closed would
 * swallow the note silently, and the operator clears a false positive with
 * one click (which stamps the column and fixes the row permanently).
 */
export function hasNewUpdate(o: NewUpdateFacts): boolean {
  const noteMs = msOrNull(o.last_team_note?.created_at);
  if (noteMs === null) return false;
  const statusMs = msOrNull(o.status_updated_at);
  if (statusMs === null) return true;
  return noteMs > statusMs;
}

/**
 * The status this order shows ON THE BOARD — New Update when a team note is
 * newer than the status, otherwise the stored value, lowercased.
 *
 * NEW UPDATE REPLACES THE DISPLAYED STATUS RATHER THAN SITTING BESIDE IT.
 * That is what keeps the Status dropdown's counts a partition (see the
 * INVARIANT comment above STATUS_FILTER_OPTIONS in
 * src/app/admin/orders/page.tsx): every row resolves to exactly one bucket.
 * A sixth value shown alongside the stored one would double-count by
 * construction, which is the mistake `expired` already made once.
 *
 * The database is untouched — the order genuinely IS still delivered. The
 * board is reporting that somebody wrote something since.
 *
 * ONE FUNCTION, EVERY SURFACE THAT READS: the badge, the filter predicate,
 * the dropdown counts and the sort rank all call this. If any of them read
 * `o.status` directly instead, that surface disagrees with the other three
 * about what the row says.
 *
 * THE ROW'S STATUS SELECT IS THE DELIBERATE EXCEPTION, and it is not an
 * oversight — it is a WRITE control, so it binds the stored status. Binding
 * it here offered `new_update` as a settable option, hid the row's real
 * status behind the flag, and made re-picking the current value look like
 * it had done nothing. Read surfaces show the flag; the one write surface
 * shows what it is about to overwrite.
 */
export function boardStatus(
  o: NewUpdateFacts & { status?: string | null },
): string {
  if (hasNewUpdate(o)) return NEW_UPDATE_STATUS;
  return (o.status ?? "").toLowerCase();
}
