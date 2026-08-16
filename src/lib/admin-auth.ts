import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  verifyAdminSession,
  verifyAdminSessionToken,
  verifyTeamOrderSession,
  verifyTeamOrderSessionToken,
} from "@/lib/admin-session";

// Service-role Supabase client. RLS is bypassed entirely, so any admin
// route using this can read/write every table regardless of policy.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Admin auth accepts the signed session token from EITHER place:
//   1. the HttpOnly `admin_session` cookie (set by /api/admin/login), or
//   2. an `Authorization: Bearer <token>` header.
// The Bearer path exists because Safari ITP drops the cookie across the
// cadieux.in -> www.cadieux.in redirect; the client stores the same signed
// token in localStorage and sends it as a header. Both go through the same
// HMAC verification, so neither can be forged and both expire in 24h.
export function isAdmin(req: NextRequest): boolean {
  if (verifyAdminSession(req)) return true;
  const auth = req.headers.get("authorization");
  if (auth && auth.startsWith("Bearer ")) {
    return verifyAdminSessionToken(auth.slice(7).trim());
  }
  return false;
}

// ── team-order dual-auth (ADDITIVE) ────────────────────────────────────
// isTeamOrderToken(req): true if the request presents a valid
// team-order session (cookie OR `Authorization: Bearer` header). This
// is checked SEPARATELY from isAdmin — a team-order token can NEVER
// satisfy isAdmin because verifyAdminSessionToken rejects any payload
// whose `p` field isn't `"admin"`.
//
// verifyAdminOrTeamOrder(req): the OPT-IN gate. Used by the small set
// of endpoints the /register form needs (POST /api/admin/orders, POST
// /api/admin/subscriptions/create, GET /api/admin/customers, GET
// /api/admin/products). Every other admin endpoint still calls
// isAdmin() directly and is therefore closed to team-PIN tokens.
export function isTeamOrderToken(req: NextRequest): boolean {
  if (verifyTeamOrderSession(req)) return true;
  const auth = req.headers.get("authorization");
  if (auth && auth.startsWith("Bearer ")) {
    return verifyTeamOrderSessionToken(auth.slice(7).trim());
  }
  return false;
}

export function verifyAdminOrTeamOrder(req: NextRequest): boolean {
  return isAdmin(req) || isTeamOrderToken(req);
}
