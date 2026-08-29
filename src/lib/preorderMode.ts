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
// publicly. Callers on the server side use `getPreorderMode()` to read; the
// client uses `usePreorderMode()` which fetches on mount + on window focus so
// a stale toggle can never persist across an admin flip. Do NOT cache it
// indefinitely — brief explicit.
//
// Admin flips the value via PUT /api/admin/preorder-mode (audit-logged).

import { createClient } from "@supabase/supabase-js";

/** Read the current pre-order mode from app_config. Server-side, no cache.
 *  Returns false on any error (missing row, malformed value, network) — the
 *  safer default is "normal mode" so a lookup failure never accidentally
 *  disables the whole store. */
export async function getPreorderMode(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
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

/** Set the pre-order mode. Admin-only caller (route enforces auth). Returns
 *  the persisted value or throws — the admin PUT route surfaces the error. */
export async function setPreorderMode(enabled: boolean): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env not configured");
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const value = enabled ? "true" : "false";
  // Upsert so a missing row is created transparently. app_config.key is PK.
  const { error } = await admin
    .from("app_config")
    .upsert({ key: "preorder_mode", value }, { onConflict: "key" });
  if (error) throw new Error(error.message);
  return enabled;
}
