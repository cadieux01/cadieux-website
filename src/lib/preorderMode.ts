// Pre-launch pre-order mode toggle.
//
// The single boolean lives in public.app_config as key='preorder_mode',
// value stored as text 'true' | 'false'. It gates:
//   • Cart / checkout banners
//   • Delivery date + slot pickers on checkout (visible-but-disabled)
//   • Subscribe CTA on /subscribe + /subscriptions/setup (visible-but-disabled)
//   • is_preorder stamp on newly-created orders + subscriptions
//   • /orders list + /orders/[id] preorder-aware display
//   • Belt-and-braces subscription refusal at the server
//
// The value is NOT sensitive — the /api/preorder-mode GET route serves it
// publicly.
//
// CACHING. This read used to be uncached on every call, and it cost more than
// anything else on the site: measured against live prod, one uncached query
// from the serverless function was a 1044 ms median TTFB for a 17-byte
// response, against 165 ms for an otherwise identical route whose read sits
// behind `unstable_cache`. The functions run in iad1 and the database is in
// ap-northeast-1, so each call paid a fresh cross-Pacific connect.
//
// It is now cached for 10 seconds AND tagged, and the admin PUT calls
// `revalidateTag(PREORDER_MODE_TAG)` after a successful write. That is
// strictly fresher than the old behaviour, not staler: an admin flip is
// visible immediately instead of waiting for each client to refetch, and the
// 10 s ceiling only bounds how long a write made by some other means (a
// direct DB edit) can go unnoticed.
//
// Admin flips the value via PUT /api/admin/preorder-mode (audit-logged).

import { unstable_cache } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Cache tag for the toggle. The admin PUT revalidates this after a write. */
export const PREORDER_MODE_TAG = "preorder-mode";

// One client per server instance instead of one per call. Building a client
// inside the function threw away the keep-alive connection to Supabase on
// every read, so each toggle lookup paid a fresh TLS handshake to Tokyo —
// measurable as ~600 ms for a 17-byte answer. Still worth having alongside
// the cache above: cache misses and every admin write go through here.
// Memoised rather than a bare module-level `createClient` so the missing-env
// case still degrades to `false` instead of throwing during module evaluation.
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

/** The actual query. Returns false on any error (missing row, malformed
 *  value, network) — the safer default is "normal mode" so a lookup failure
 *  never accidentally disables the whole store. */
async function readPreorderMode(): Promise<boolean> {
  const admin = getAdmin();
  if (!admin) return false;
  const { data, error } = await admin
    .from("app_config")
    .select("value")
    .eq("key", "preorder_mode")
    .maybeSingle();
  if (error) {
    console.warn("[preorderMode] read failed:", error.message);
    return false;
  }
  const raw = String(data?.value ?? "").trim().toLowerCase();
  return raw === "true";
}

const getPreorderModeCached = unstable_cache(
  readPreorderMode,
  ["preorder-mode"],
  { revalidate: 10, tags: [PREORDER_MODE_TAG] },
);

/** Read the current pre-order mode. Cached for 10 s behind
 *  PREORDER_MODE_TAG — use this everywhere EXCEPT the admin write path. */
export async function getPreorderMode(): Promise<boolean> {
  return getPreorderModeCached();
}

/** Uncached read, for the admin write path only.
 *
 *  The PUT compares the current value against the requested one and skips the
 *  write when they match. Reading that comparison from the cache would be a
 *  correctness bug, not just a stale render: if the cache said `false` while
 *  the row said `true`, an admin turning pre-order mode OFF would be told
 *  "no change" and the DB would stay ON. Always hit the row. */
export async function getPreorderModeUncached(): Promise<boolean> {
  return readPreorderMode();
}

/** Set the pre-order mode. Admin-only caller (route enforces auth). Returns
 *  the persisted value or throws — the admin PUT route surfaces the error. */
export async function setPreorderMode(enabled: boolean): Promise<boolean> {
  const admin = getAdmin();
  if (!admin) throw new Error("Supabase env not configured");
  const value = enabled ? "true" : "false";
  // Upsert so a missing row is created transparently. app_config.key is PK.
  const { error } = await admin
    .from("app_config")
    .upsert({ key: "preorder_mode", value }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return enabled;
}
