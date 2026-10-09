// What an admin CSV export is allowed to contain, and how it says so.
//
// WHY THIS EXISTS. The orders board is bounded (see DEFAULT_LIMIT in
// api/admin/orders/route.ts) and both export buttons were wired to the
// board's already-filtered rows. So from the moment the bound landed, a
// click on Export produced a file covering 250 of 718 orders with nothing
// anywhere — not the filename, not a column, not the UI — saying so. A
// short CSV looks exactly like a quiet month. That is data loss that
// reads as data.
//
// The rule this module enforces: an export covers every row that exists
// server-side, subject ONLY to the filters the operator can see on
// screen. The board's own display bound must never reach the file.
//
// It is deliberately DEPENDENCY-FREE. Nothing here imports from "@/…",
// which is what lets tests/export-scope.test.mjs run it directly under
// `node --test` with no bundler, no test framework and no new devDeps.
// Keep it that way: the moment this file imports an alias, the only
// automated check on the export's scope stops running.

export type ExportScope<T> = {
  /** The rows to write. Never the board's bounded window. */
  rows: T[];
  /** One sentence, written into the file, stating what it covers. */
  note: string;
};

/**
 * The operator-facing scope sentence. Pure and separately testable
 * because this string is the only thing standing between a filtered
 * export and someone reading it as the whole book.
 *
 * `written` is how many rows are in the file; `total` is how many exist
 * server-side before any filter. Equal counts state completeness
 * outright; unequal counts name the filters as the reason, so a short
 * file is never ambiguous between "quiet month" and "truncated export".
 */
export function exportScopeNote(input: {
  written: number;
  total: number;
  label: string;
}): string {
  const { written, total, label } = input;
  if (written === total) {
    return `All ${total} ${label} (complete — no board limit applied)`;
  }
  return `${written} of ${total} ${label} — current filters applied, board limit NOT applied`;
}

/**
 * Resolve which rows an export should write.
 *
 * `loaded` is what the board is holding, already filtered and sorted for
 * display. When the board is showing a slice of the table (`truncated`),
 * that set is NOT good enough for a file: we re-fetch the whole table and
 * re-apply the operator's filters to it via `applyFilters`, so the result
 * differs from the on-screen list only in the rows the bound had hidden.
 *
 * `fetchAll` rejecting is deliberately NOT caught. Producing a quietly
 * partial file is the bug this module exists to prevent, so the caller
 * must surface the failure and write nothing — see the catch around the
 * export handler.
 */
export async function resolveExportScope<T>(input: {
  loaded: T[];
  total: number;
  truncated: boolean;
  label: string;
  fetchAll: () => Promise<T[]>;
  applyFilters: (rows: T[]) => T[];
}): Promise<ExportScope<T>> {
  const { loaded, total, truncated, label, fetchAll, applyFilters } = input;

  const rows = truncated ? applyFilters(await fetchAll()) : loaded;

  // `total` is the server's count of the whole table. A filtered export
  // is correctly shorter than it; an UNfiltered one must match it, and
  // that equality is what the test pins.
  return { rows, note: exportScopeNote({ written: rows.length, total, label }) };
}
