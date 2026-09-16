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
//   • the two groups are AND'd        → Pending AND "Did not lift the call"
// An EMPTY group means "no constraint from this group", which is why
// "All statuses" is simply the empty status list rather than a magic value.

/** The fields the predicate reads. Structural so both AdminOrderRow and the
 *  print view's row type satisfy it without a cast. */
export type FilterableOrder = {
  status?: string | null;
  computed_state?: string | null;
  last_call_note?: { body?: string | null } | null;
};

/** Marks a filter value as a call-update body rather than a stored status. */
export const CALL_PREFIX = "call:";

// ---------------------------------------------------------------------------
// Date basis
//
// WHICH column the date range applies to. This belongs here for the same
// reason the status predicate does: the table and the packing list must
// agree. They did not — the table filters on delivery_date by default
// while print filtered on created_at unconditionally, and with a ~12h
// booking lead those two sets barely intersect, so the sheet carried into
// the kitchen listed different orders than the screen it was printed from.
// ---------------------------------------------------------------------------

export type DateBasis = "delivery" | "order";

/** The default for both views. Operational decisions on this board —
 *  baking, routing, calling — are all about the delivery date. */
export const DEFAULT_BASIS: DateBasis = "delivery";

/** Narrow an untrusted `?basis=` value, falling back to the default so an
 *  older link that predates the param prints what today's screen shows. */
export function parseBasis(raw: string | null | undefined): DateBasis {
  return raw === "delivery" || raw === "order" ? raw : DEFAULT_BASIS;
}

/** The fields the basis selector reads. */
export type DatedOrder = {
  created_at: string;
  delivery_date?: string | null;
};

/** The column the range is applied to. A row with no value on the chosen
 *  column drops out of the view: a row with no delivery_date has nothing
 *  to deliver on the operator's chosen day. */
export function orderDateForBasis(
  o: DatedOrder,
  basis: DateBasis,
): string | null | undefined {
  return basis === "delivery" ? o.delivery_date : o.created_at;
}

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
} {
  const statuses: string[] = [];
  const calls: string[] = [];
  for (const v of values) {
    if (v === ALL_VALUE) continue;
    if (v.startsWith(CALL_PREFIX)) calls.push(v.slice(CALL_PREFIX.length));
    else statuses.push(v);
  }
  return { statuses, calls };
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
): boolean {
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
