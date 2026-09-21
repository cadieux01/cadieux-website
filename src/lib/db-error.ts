// Turning a PostgREST error into something an operator can act on.
//
// A flat "Failed to save row pin." hid a 42P10 for the entire life of the
// zone row-pin endpoint: every write failed, the table stayed at zero rows,
// and the dialog said the same eight words each time. adminFetch puts the
// `error` field straight into the thrown message, so whatever goes here is
// what the operator reads.

export type DbErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
} | null;

/** "42P10: there is no unique or exclusion constraint matching..." */
export function describeDbError(error: DbErrorLike, fallback: string): string {
  if (!error) return fallback;
  const parts = [error.code, error.message].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  return parts.length > 0 ? parts.join(": ") : fallback;
}
