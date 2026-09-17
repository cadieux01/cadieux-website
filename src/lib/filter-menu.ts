// The admin filter-MENU builders, in ONE place.
//
// order-filter.ts owns the PREDICATE (what a selection matches).
// This module owns the MENU (what the dropdown lists, and what the closed
// trigger reads). They were never separable in practice — the menu's counts
// have to agree with the predicate's output or the board lies about itself —
// but until now the menu half lived inline inside /admin/orders/page.tsx,
// which meant /admin/subscriptions could not reuse a line of it and grew a
// hand-rolled chip row instead. That chip row then drifted in three separate
// ways (a status that does not exist, a computed filter counted as a status,
// and a hidden payment filter), which is exactly the class of bug this file
// exists to stop.
//
// Everything here is a PURE function over (values, counts, selection). No
// React, no fetching, no row types — so both boards can call it and a test
// can too.

import { ALL_VALUE } from "@/lib/order-filter";

/** One row in the MultiSelect menu. Mirrors MultiSelectOption. */
export type FilterMenuOption = {
  value: string;
  label: string;
  /** Non-interactive group heading. */
  disabled?: boolean;
  /** A command (e.g. "Clear all"): clickable, never ticked. */
  action?: boolean;
};

/**
 * Menu command, not a filter value — never enters the selection.
 *
 * Lives here rather than in either page because both menus offer it and a
 * second copy of the literal would be a silent no-op the day one changed.
 */
export const CLEAR_ALL = "__clear_all";

/** A non-interactive group heading, e.g. "── Call updates ──". */
export function separator(value: string, heading: string): FilterMenuOption {
  return { value, label: `── ${heading} ──`, disabled: true };
}

/**
 * The status group.
 *
 * TWO RULES, both learned the hard way:
 *
 *  1. ZERO-COUNT OPTIONS ARE HIDDEN — unless currently ticked. A ticked
 *     option must stay listed even at zero, or narrowing the date range
 *     hides the very filter that is suppressing the rows and the operator
 *     sees an empty table with no way to tell why.
 *
 *  2. THE CALLER PASSES THE VALUES, AND SHOULD DERIVE THEM FROM DATA.
 *     A hardcoded status array is what hid 46 pending orders on the orders
 *     board, and what put a "PAUSED · 0" chip on the subscriptions board for
 *     a status that has never existed in public.subscriptions. Pass
 *     `distinctStatuses(rows)` unless you have a reason not to.
 */
export function statusGroupOptions(
  values: readonly string[],
  counts: Readonly<Record<string, number>>,
  selected: readonly string[],
  labelFor: (value: string) => string,
  allLabel = "All statuses",
): FilterMenuOption[] {
  const opts: FilterMenuOption[] = [];
  for (const v of values) {
    if (v === ALL_VALUE || selected.includes(v) || (counts[v] ?? 0) > 0) {
      const label = v === ALL_VALUE ? allLabel : labelFor(v);
      opts.push({ value: v, label: `${label} (${counts[v] ?? 0})` });
    }
  }
  return opts;
}

/**
 * The DISTINCT statuses actually present, in the caller's preferred order
 * first and anything unrecognised appended alphabetically.
 *
 * The tail matters: a status nobody anticipated (a new enum value, a hand-
 * edited row) still reaches the menu instead of becoming invisible rows.
 */
export function distinctStatuses(
  rows: readonly { status?: string | null }[],
  preferredOrder: readonly string[] = [],
): string[] {
  const present = new Set<string>();
  for (const r of rows) {
    const s = (r.status ?? "").trim().toLowerCase();
    if (s) present.add(s);
  }
  const ordered = preferredOrder.filter((v) => present.has(v));
  const rest = Array.from(present)
    .filter((v) => !preferredOrder.includes(v))
    .sort();
  return [...ordered, ...rest];
}

/**
 * What the closed trigger reads. One ticked → "Pending (27)". Two or more →
 * "Pending +2 (43)". Nothing ticked → "All statuses (212)".
 *
 * HARD INVARIANT: the bracketed number is the LIVE ROW COUNT — exactly what
 * the table below is showing, in every combination, no exceptions. It is NOT
 * the sum of the ticked options' counts. The sum only equals the row count
 * when the selection is pure-status; tick a second group as well and the
 * groups AND, so the sum becomes an upper bound (153 against 16 rows in one
 * run). A number in the filter that disagrees with the list underneath it is
 * worse than no number at all.
 */
export function triggerLabel(
  options: readonly FilterMenuOption[],
  selected: readonly string[],
  totalRows: number,
  allLabel = "All statuses",
): string {
  const picked = options.filter(
    (o) => !o.disabled && !o.action && selected.includes(o.value),
  );
  if (picked.length === 0) return `${allLabel} (${totalRows})`;
  // Strip the option's own "(n)" — the label carries the live one.
  const head = picked[0].label.replace(/\s*\(\d+\)\s*$/, "");
  const rest = picked.length - 1;
  return rest === 0 ? `${head} (${totalRows})` : `${head} +${rest} (${totalRows})`;
}

/**
 * THE INVARIANT: real-status counts partition the rows.
 *
 * Every row has exactly one `status`, so the per-status counts must sum to
 * the header count. A COMPUTED filter ("expiring in 7 days", "expired") is
 * not a status — it overlaps them — so listing it beside them breaks the
 * sum and the board starts lying. On the subscriptions board the 7 expiring
 * rows were 3 pending_confirmation + 2 active + 2 completed, all of which
 * were ALSO counted in their own chips.
 *
 * Asserts the RELATIONSHIP, never a hardcoded total: the number moves daily.
 *
 * Dev-only and non-throwing. A miscounted filter must not white-screen a
 * board Sunny is using to run the day — it must leave a loud breadcrumb in
 * the console and keep rendering.
 */
export function assertStatusCountsPartition(
  label: string,
  counts: Readonly<Record<string, number>>,
  statusValues: readonly string[],
  headerCount: number,
): void {
  if (process.env.NODE_ENV === "production") return;
  const sum = statusValues.reduce((n, v) => n + (counts[v] ?? 0), 0);
  if (sum !== headerCount) {
    console.error(
      `[${label}] status counts do not partition the rows: ` +
        `${statusValues.map((v) => `${v}=${counts[v] ?? 0}`).join(" + ")} = ${sum}, ` +
        `but the board is showing ${headerCount} rows. ` +
        `A computed filter has almost certainly been listed as a status.`,
    );
  }
}
