import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAdminSession } from "@/lib/admin-session";

// Service-role Supabase client. RLS is bypassed entirely, so any admin
// route using this can read/write every table regardless of policy.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Admin auth = signed `admin_session` cookie. The legacy `x-admin-token`
// header path was removed when the operator-facing password gate was
// moved to /api/admin/login (Phase 1 security). Routes that still call
// `isAdmin(req)` work unchanged — they now resolve the cookie instead
// of the header.
export function isAdmin(req: NextRequest): boolean {
  return verifyAdminSession(req);
}
