// POST /api/admin/logout — clears the admin_session cookie.

import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/admin-session";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return res;
}
