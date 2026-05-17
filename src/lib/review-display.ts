// Helpers shared by the review API routes for shaping rows before they
// reach the client. Two concerns:
//
//   1. Only the first whitespace-delimited token of the submitted
//      author_name is shown publicly. Customers can submit full names
//      during checkout etc. — we don't want surnames leaking into a
//      public reviews list. Falls back to "Anonymous" for empty/whitespace
//      values.
//
//   2. The persisted `customer_phone` (added in the soft-delete migration)
//      is sensitive — never serialise it to the client. Routes instead
//      compute an `is_owner` boolean by comparing it to the verified phone
//      of the calling user.

/** First whitespace-delimited token of `name`, or "Anonymous" when empty. */
export function publicDisplayName(name: string | null | undefined): string {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return "Anonymous";
  return trimmed.split(/\s+/)[0] || "Anonymous";
}

/** Edit window: 24 hours from created_at. */
export const REVIEW_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** True iff `created_at` is within the 24h edit window from now. */
export function isWithinEditWindow(createdAt: string | Date): boolean {
  const t = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < REVIEW_EDIT_WINDOW_MS;
}
