// SERVER ONLY, ENFORCED AT BUILD TIME.
//
// `supabaseAdmin` below is constructed at module scope from
// SUPABASE_SERVICE_ROLE_KEY. That variable is not NEXT_PUBLIC_-prefixed, so in
// a client bundle Next replaces it with `undefined` and createClient throws
// "supabaseUrl is required" during module initialisation. The client tree then
// never mounts, React discards the server-rendered HTML, and the page goes
// BLANK — with no failing request, no 500, and nothing in the server log to
// point at. It is a miserable thing to debug and it has happened twice:
// b012899 (lib/geocode pulled into the checkout page) and 9418bac
// (lib/audit-log pulled into /admin/audit-log, blank for 146 days before
// anyone traced it).
//
// `server-only` makes the second one impossible. It is a marker package whose
// "react-server" export condition resolves to an empty module on the server
// and to a module that throws at BUILD time in a client bundle, so importing
// this file from a "use client" component now fails `next build` with a named
// error instead of shipping a blank page.
//
// If this import starts failing the build: that is it working. Find the
// "use client" file in the import chain and give it a module with no server
// imports — lib/audit-log-schema.ts is the worked example.
import "server-only";

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
