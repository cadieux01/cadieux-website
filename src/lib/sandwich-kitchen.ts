// Sandwich kitchen toggle + hours.
//
// Three keys in public.app_config:
//   sandwich_kitchen_enabled   — 'true' | 'false'  (default 'false')
//   sandwich_kitchen_open      — 'HH:MM' IST wall-clock (default '13:00')
//   sandwich_kitchen_close     — 'HH:MM' IST wall-clock (default '23:00')
//
// Stored as text (not `time`) because every reader treats them as literal
// IST strings — the timezone hint is what matters, and Postgres `time` has
// no timezone. Read via service_role because the rows sit behind RLS.
//
// The three values are read AS A GROUP — a caller that only needs the
// switch still gets the hours in the same round-trip. Cheaper than three
// separate lookups and matches how the admin card renders.
//
// CACHING. Mirrors preorderMode: 10 s `unstable_cache` behind
// SANDWICH_KITCHEN_TAG, with the admin PUT calling `revalidateTag(...)`
// after a successful write so a Sunny-flip is visible immediately instead
// of after each caller's next refetch. The 10 s ceiling only bounds how
// long a change made outside the admin surface (a direct DB edit) can go
// unnoticed. The admin write path itself must call
// `getSandwichKitchenStateUncached()` — reading through the cache during
// a compare-and-write is a correctness bug (stale "no change" verdicts).

import { unstable_cache } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SandwichKitchenState = {
  enabled: boolean;
  open: string;   // "HH:MM" IST
  close: string;  // "HH:MM" IST
};

/** Cache tag for the kitchen state. Admin PUT revalidates this after a write. */
export const SANDWICH_KITCHEN_TAG = "sandwich-kitchen";

const DEFAULTS: SandwichKitchenState = {
  enabled: false,
  open: "13:00",
  close: "23:00",
};

const KEYS = [
  "sandwich_kitchen_enabled",
  "sandwich_kitchen_open",
  "sandwich_kitchen_close",
] as const;

function isHHMM(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

// Memoised service_role client — same reasoning as preorderMode. Building a
// fresh client per call throws away the keep-alive TLS connection to Supabase
// (measurable as ~600 ms per read from iad1 → ap-northeast-1).
let cachedAdmin: SupabaseClient | null = null;
function getAdmin(): SupabaseClient | null {
  if (cachedAdmin) return cachedAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cachedAdmin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedAdmin;
}

/** The actual query. Missing rows fall back to DEFAULTS. Any error returns
 *  DEFAULTS — a lookup failure must NEVER accidentally open the kitchen.
 *  Safer default is closed. */
async function readSandwichKitchenState(): Promise<SandwichKitchenState> {
  const admin = getAdmin();
  if (!admin) return DEFAULTS;
  const { data, error } = await admin
    .from("app_config")
    .select("key, value")
    .in("key", KEYS as unknown as string[]);
  if (error) {
    console.warn("[sandwich-kitchen] read failed:", error.message);
    return DEFAULTS;
  }
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    if (typeof row.key === "string" && typeof row.value === "string") {
      map.set(row.key, row.value);
    }
  }
  const rawEnabled = (map.get("sandwich_kitchen_enabled") ?? "false").trim().toLowerCase();
  const rawOpen = map.get("sandwich_kitchen_open") ?? DEFAULTS.open;
  const rawClose = map.get("sandwich_kitchen_close") ?? DEFAULTS.close;
  return {
    enabled: rawEnabled === "true",
    open: isHHMM(rawOpen) ? rawOpen : DEFAULTS.open,
    close: isHHMM(rawClose) ? rawClose : DEFAULTS.close,
  };
}

const getSandwichKitchenStateCached = unstable_cache(
  readSandwichKitchenState,
  ["sandwich-kitchen"],
  { revalidate: 10, tags: [SANDWICH_KITCHEN_TAG] },
);

/** Read the current kitchen state. Cached for 10 s behind
 *  SANDWICH_KITCHEN_TAG — use this everywhere EXCEPT the admin write path. */
export async function getSandwichKitchenState(): Promise<SandwichKitchenState> {
  return getSandwichKitchenStateCached();
}

/** Uncached read, for the admin write path only. See preorderMode for the
 *  correctness argument — a compare-and-write against a stale cache would
 *  silently drop admin flips ("no change" while the row disagrees). */
export async function getSandwichKitchenStateUncached(): Promise<SandwichKitchenState> {
  return readSandwichKitchenState();
}

/** Write any subset of the three keys. Caller must be admin-authed. Route is
 *  responsible for calling `revalidateTag(SANDWICH_KITCHEN_TAG)` after this
 *  resolves — this function stays cache-agnostic so unit tests do not need
 *  to stub `next/cache`. */
export async function setSandwichKitchenState(
  patch: Partial<SandwichKitchenState>,
): Promise<SandwichKitchenState> {
  const admin = getAdmin();
  if (!admin) throw new Error("Supabase env not configured");

  const rows: { key: string; value: string }[] = [];
  if (typeof patch.enabled === "boolean") {
    rows.push({ key: "sandwich_kitchen_enabled", value: patch.enabled ? "true" : "false" });
  }
  if (typeof patch.open === "string") {
    if (!isHHMM(patch.open)) throw new Error("open must be HH:MM (24h)");
    rows.push({ key: "sandwich_kitchen_open", value: patch.open });
  }
  if (typeof patch.close === "string") {
    if (!isHHMM(patch.close)) throw new Error("close must be HH:MM (24h)");
    rows.push({ key: "sandwich_kitchen_close", value: patch.close });
  }

  if (rows.length === 0) {
    return readSandwichKitchenState();
  }

  const { error } = await admin
    .from("app_config")
    .upsert(rows, { onConflict: "key" });
  if (error) throw new Error(error.message);

  return readSandwichKitchenState();
}
