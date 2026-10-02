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
//   • zones are OR'd together         → Zone 1 OR Zone 4 OR Pickup
//   • payments are OR'd together      → Paid OR Awaiting
//   • "repeat customers only" is a single flag
//   • the groups are AND'd            → Pending AND "Did not lift" AND repeat AND Zone 2
// An EMPTY group means "no constraint from this group", which is why
// "All statuses" is simply the empty status list rather than a magic value.

import { ZONE_KEYS, type ZoneKey } from "@/lib/delivery-zones";
import {
  isPaymentView,
  paymentView,
  type PaymentView,
} from "@/lib/payment-label";

/** The fields the predicate reads. Structural so both AdminOrderRow and the
 *  print view's row type satisfy it without a cast. `zone` is derived (never
 *  stored) — the board resolves it once via delivery-zones.ts before running
 *  the predicate. */
export type FilterableOrder = {
  status?: string | null;
  computed_state?: string | null;
  last_call_note?: { body?: string | null } | null;
  /** 1-based ordinal of this order for its customer; see
   *  src/lib/customer-history.ts. 2+ = they had ordered before. */
  repeat_seq?: number | null;
  /** The two stored payment columns. Read ONLY through paymentView() — the
   *  bucket an operator filters by must be the bucket the badge prints, and
   *  there is one function that decides it. Both optional so print's lean
   *  row type stays satisfiable; absent means `unknown`, which no live row
   *  is and which the menu therefore does not offer. */
  payment_status?: string | null;
  payment_method?: string | null;
  /** Resolved zone for this row. See src/lib/delivery-zones.ts. Optional
   *  so print's lean row type does not have to carry it when print never
   *  filters by zone — an absent zone under an active zone filter simply
   *  fails to match, which is the correct answer. */
  zone?: ZoneKey | null;
};

/** Marks a filter value as a call-update body rather than a stored status. */
export const CALL_PREFIX = "call:";

/** Marks a filter value as a zone key (e.g. "zone:zone1", "zone:pickup").
 *  Kept in the same flat selection as statuses and calls so the dropdown, the
 *  URL and the print view all stay on one representation. */
export const ZONE_PREFIX = "zone:";

/** Marks a filter value as a payment bucket (e.g. "pay:paid", "pay:awaiting").
 *  The bucket names are PAYMENT_VIEWS in @/lib/payment-label — the same four
 *  the badge in the table prints, so the menu can never offer a word the rows
 *  do not use. */
export const PAY_PREFIX = "pay:";

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
 * Split a flat selection (what the dropdown holds) into its five groups.
 * `"call:…"` → calls; `"zone:…"` → zones; `"pay:…"` → payments;
 * `"repeat:only"` → repeatOnly flag; `"all"` is dropped (an empty status list
 * already means "all"); everything else → statuses.
 *
 * A `pay:` value that is not a known bucket is DROPPED, unlike a zone, which
 * is cast. The difference is deliberate: an unrecognised payment bucket would
 * match no row and silently empty the table, whereas dropping it degrades to
 * "no payment constraint" — the state the operator sees described as "All
 * statuses". Failing open is right here because the group is additive; a
 * stale link is far likelier than a hostile one on an admin board.
 */
export function splitFilterValues(values: readonly string[]): {
  statuses: string[];
  calls: string[];
  zones: ZoneKey[];
  payments: PaymentView[];
  repeatOnly: boolean;
} {
  const statuses: string[] = [];
  const calls: string[] = [];
  const zones: ZoneKey[] = [];
  const payments: PaymentView[] = [];
  let repeatOnly = false;
  for (const v of values) {
    if (v === ALL_VALUE) continue;
    if (v === REPEAT_ONLY) repeatOnly = true;
    else if (v.startsWith(CALL_PREFIX)) calls.push(v.slice(CALL_PREFIX.length));
    else if (v.startsWith(ZONE_PREFIX))
      zones.push(v.slice(ZONE_PREFIX.length) as ZoneKey);
    else if (v.startsWith(PAY_PREFIX)) {
      const p = v.slice(PAY_PREFIX.length);
      if (isPaymentView(p)) payments.push(p);
    } else statuses.push(v);
  }
  return { statuses, calls, zones, payments, repeatOnly };
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
  zones: readonly ZoneKey[] = [],
  payments: readonly PaymentView[] = [],
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
  if (zones.length > 0) {
    // An unresolved (null/undefined) zone under an active zone filter fails
    // to match, by design. Every row that this predicate sees SHOULD have
    // been enriched with a resolved zone by the board — a bare null here
    // means the enrichment step was skipped, not that the row is "unzoned"
    // (which is itself a real zone with its own key). Failing closed keeps
    // that mistake visible instead of silently over-including rows.
    if (!o.zone || !zones.includes(o.zone)) return false;
  }
  if (payments.length > 0) {
    // Derived, not stored — like zone. paymentView() is the only thing
    // allowed to decide which bucket a row is in, so the filter, the badge
    // in the table and the badge on the sheet cannot drift apart.
    if (!payments.includes(paymentView(o))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// URL encoding
//
// The `status` codec itself is table-agnostic and lives in filter-menu.ts —
// the subscriptions board encodes its own values with the same pair.
//
// What is specific to THIS board is which groups may ride it. `status` stays
// COMMA-SEPARATED, so a pre-existing single-value link (`?status=confirmed`)
// still means exactly what it always did. That is safe for this group and only
// this group: every status value is a fixed enum key from ORDER_FILTER_VALUES,
// none of which contains a comma.
//
// Call updates get their own REPEATED `call` param instead. Their values are
// note bodies — free text, typed by an operator through the custom call-note
// escape hatch — so one comma in a body would silently split a filter into two
// filters that match nothing. Repeated params have no such failure mode.
// ---------------------------------------------------------------------------

// Zone param — comma-separated ZoneKey values ("zone1,pickup"). Zone keys are
// a closed enum (see ZONE_KEYS in delivery-zones.ts), none contains a comma,
// so the same shape as `status` is safe. Kept on its own param so a status
// selection and a zone selection stay orthogonal in the URL.

// Derived, not retyped. This was a hand-written duplicate of ZONE_KEYS, and a
// duplicate that falls behind is worse than no check: a key missing here is
// silently STRIPPED from the URL, so the board loads with a filter the link
// asked for and the screen never mentions it.
const VALID_ZONE_KEYS: readonly string[] = ZONE_KEYS;

export function encodeZoneParam(zones: readonly ZoneKey[]): string {
  return zones.length === 0 ? "" : zones.join(",");
}

export function decodeZoneParam(raw: string | null): ZoneKey[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ZoneKey => VALID_ZONE_KEYS.includes(s));
}

// Payment param — comma-separated PaymentView values ("paid,awaiting"), on
// its own `pay` param for the same reason zones got one: the groups are
// orthogonal and a link that narrows payment should read plainly. The
// vocabulary is validated against PAYMENT_VIEWS rather than a copy of it
// here, so appending a bucket there is the only edit a new bucket needs.

export function encodePayParam(payments: readonly PaymentView[]): string {
  return payments.length === 0 ? "" : payments.join(",");
}

export function decodePayParam(raw: string | null): PaymentView[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(isPaymentView);
}
