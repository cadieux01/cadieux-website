import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Service-role Supabase client. RLS is bypassed entirely, so any admin
// route using this can read/write every table regardless of policy.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Header convention shared with /api/reviews/* and /api/subscriptions/*.
export function isAdmin(req: NextRequest): boolean {
  return req.headers.get("x-admin-token") === process.env.ADMIN_TOKEN;
}
