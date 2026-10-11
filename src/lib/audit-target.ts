// What the audit log's Target column says.
//
// Lives in its own module, with no `@/` imports, for the same reason
// lib/export-scope.ts does: `node --test` can then run the real function
// against real prod rows (tests/audit-target.test.mjs). An alias here would
// silently kill that check.
//
// THE STORED LABEL IS A SNAPSHOT AND CANNOT BE REPAIRED. `audit_log` is
// append-only at the database level — triggers audit_log_no_update /
// audit_log_no_delete raise P0001 on any UPDATE — so the 1,595 order rows
// whose `target_label` holds a UUID slice like '#5fa927fd' will hold it
// forever. The code is therefore derived from `target_id` on every read (see
// api/admin/audit-log/route.ts, which sets `target_code`) and combined with
// the stored label here. docs/audit-log-relabel-WONTRUN.md has the full
// account of why the backfill was abandoned.

/** Only the two fields this needs, so a whole AuditLogRow is assignable and
 *  the test can pass a literal copied from prod. */
export type AuditTargetLike = {
  target_label?: string | null;
  /** Resolved from target_id at read time. Null = the order or subscription
   *  no longer exists, so there is no code to show. */
  target_code?: string | null;
};

/** A stored label that is nothing but a slice of the id shown beside it:
 *  '#5fa927fd', 'sub f2eaaadd'. Once the code is resolved these carry no
 *  information — the full target_id is already rendered underneath. */
const UUID_SLICE_LABEL = /^(?:order|sub(?:scription)?)?[\s#]*[0-9a-f]{8}$/i;

/**
 * The Target cell, as one string.
 *
 * The code wins, because it is the only thing that identifies the row's
 * target to a human. The stored label is KEPT ALONGSIDE it when it says
 * something the code does not: 128 subscription rows carry a product name
 * that exists nowhere else on the row, so they read
 * 'OLS66 — Protein Rich Bread'. It is dropped only when it is the code
 * already, or a slice of the id.
 *
 * With no code — the target was deleted, 155 order and 8 subscription rows —
 * the stored label stands alone. That is the honest answer rather than a
 * placeholder: the UUID slice really is all that is known about the event.
 */
export function targetDisplay(r: AuditTargetLike): string {
  const label = (r.target_label ?? "").trim();
  const code = (r.target_code ?? "").trim();
  if (!code) return label;
  if (!label || label === code || UUID_SLICE_LABEL.test(label)) return code;
  // The writers now store the code themselves; don't print it twice.
  if (label.startsWith(code)) return label;
  return `${code} — ${label}`;
}
