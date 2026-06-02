// POST /api/admin/logout — clears the admin_session cookie.

import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, adminCookieDomain } from "@/lib/admin-session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  // Must mirror the login cookie's domain, otherwise the browser keeps
  // the `.cadieux.in`-scoped cookie and sign-out has no effect.
  res.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
    domain: adminCookieDomain(req.headers.get("host")),
  });
  return res;
}
