// The admin order-filter semantics, in ONE place.
//
// Two consumers must agree exactly: the table at /admin/orders and the
// packing list at /admin/orders/print, which the table links to with the
// current filter in the query string. They had already drifted — print
// never handled the `call:` filter values at all, so choosing a call
// update and hitting Print silently produced a list filtered only by
// date and search. A packing list that quietly disagrees with the screen
// it was printed from is worse than one that errors, so the predicate
// lives here and both import it.
//
// SEMANTICS (this is the part that gets messy — pin it):
//   • statuses are OR'd together      → Pending OR Confirmed OR Preparing
//   • call updates are OR'd together  → "Did not lift" OR "Call back later"
//   • "repeat customers only" is a single flag
//   • the groups are AND'd            → Pending AND "Did not lift" AND repeat
// An EMPTY group means "no constraint from this group", which is why
// "All statuses" is simply the empty status list rather than a magic value.

/** The fields the predicate reads. Structural so both AdminOrderRow and the
 *  print view's row type satisfy it without a cast. */
export type FilterableOrder = {
  status?: string | null;
  computed_state?: string | null;
  last_call_note?: { body?: string | null } | null;
  /** 1-based ordinal of this order for its customer; see
   *  src/lib/customer-history.ts. 2+ = they had ordered before. */
  repeat_seq?: number | null;
};

/** Marks a filter value as a call-update body rather than a stored status. */
export const CALL_PREFIX = "call:";

/** The one value in the "repeat customers only" group. Kept in the same
 *  flat selection as statuses and calls so the dropdown, the URL and the
 *  print view all stay on one representation. */
export const REPEAT_ONLY = "repeat:only";

// DATE FILTERING LIVES IN @/lib/day-filter.
//
// `DateBasis`, `parseBasis` and `orderDateForBasis` used to be declared
// here. They moved when the From/To range became a single day: the basis
// and the day are one decision (reading the right column on the wrong day
// and the wrong column on the right day are the same bug) and the
// subscriptions board needs them too, which this status-only module has no
// business knowing about. This file now owns the status/call/repeat
// predicate and nothing else.

/** The value that means "no status constraint". Kept as a real option in the
 *  menu (operators expect to see it) but it is never stored in the selection —
 *  an empty status list IS "all", so the two can never disagree. */
export const ALL_VALUE = "all";

/**
 * Split a flat selection (what the dropdown holds) into its two groups.
 * `"call:Did not lift the call"` → calls; everything else → statuses.
 * `"all"` is dropped: it is represented by an empty status list.
 */
export function splitFilterValues(values: readonly string[]): {
  statuses: string[];
  calls: string[];
  repeatOnly: boolean;
} {
  const statuses: string[] = [];
  const calls: string[] = [];
  let repeatOnly = false;
  for (const v of values) {
    if (v === ALL_VALUE) continue;
    if (v === REPEAT_ONLY) repeatOnly = true;
    else if (v.startsWith(CALL_PREFIX)) calls.push(v.slice(CALL_PREFIX.length));
    else statuses.push(v);
  }
  return { statuses, calls, repeatOnly };
}

/**
 * OR within each group, AND across the groups. An empty group is unconstrained.
 *
 * `expired` is special and must stay special: it is NOT a stored
 * `orders.status`, it is computed on read (see src/lib/order-state.ts) from
 * rows that also carry `pending`/`placed`. It is no longer offered in the menu
 * but old bookmarks and print URLs still carry it, so it is still matched.
 */
export function matchesOrderFilter(
  o: FilterableOrder,
  statuses: readonly string[],
  calls: readonly string[],
  repeatOnly = false,
): boolean {
  // A repeat order is one where the SAME phone has an earlier
  // non-cancelled order. Cancelled rows carry no repeat_seq at all, so
  // they never pass this gate.
  if (repeatOnly && (o.repeat_seq ?? 0) < 2) return false;
  if (statuses.length > 0) {
    const s = (o.status ?? "").toLowerCase();
    const hit = statuses.some((v) =>
      v === "expired" ? o.computed_state === "expired" : s === v,
    );
    if (!hit) return false;
  }
  if (calls.length > 0) {
    const body = o.last_call_note?.body ?? "";
    if (!calls.includes(body)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// URL encoding
//
// `status` stays COMMA-SEPARATED, so a pre-existing single-value link
// (`?status=confirmed`) still means exactly what it always did. That is safe
// for this group and only this group: every status value is a fixed enum key
// from ORDER_FILTER_VALUES, none of which contains a comma.
//
// Call updates get their own REPEATED `call` param instead. Their values are
// note bodies — free text, typed by an operator through the custom call-note
// escape hatch — so one comma in a body would silently split a filter into two
// filters that match nothing. Repeated params have no such failure mode.
// ---------------------------------------------------------------------------

/** `["pending","confirmed"]` → `"pending,confirmed"`; empty → `"all"`. */
export function encodeStatusParam(statuses: readonly string[]): string {
  return statuses.length === 0 ? ALL_VALUE : statuses.join(",");
}

/** Inverse of encodeStatusParam. `null`/`"all"`/`""` → `[]` (unconstrained). */
export function decodeStatusParam(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s !== ALL_VALUE);
}
