// POST /api/admin/login
//
// Accepts { password } and, on a constant-time match with ADMIN_TOKEN,
// sets an HttpOnly + Secure + SameSite=Strict `admin_session` cookie
// signed by HMAC-SHA256(ADMIN_TOKEN, payload). The browser never sees
// ADMIN_TOKEN itself. Rate-limited to 5 attempts/minute per IP.

import { NextRequest, NextResponse } from "next/server";

import { getClientIP } from "@/lib/ratelimit";
import {
  ADMIN_SESSION_COOKIE,
  adminCookieDomain,
  adminSessionCookieMaxAgeSeconds,
  clearLoginAttempts,
  registerLoginAttempt,
  safeEqual,
  signAdminSession,
} from "@/lib/admin-session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const throttle = registerLoginAttempt(ip);
  if (!throttle.allowed) {
    return NextResponse.json(
      {
        error: "Too many login attempts. Try again shortly.",
        retryAfterMs: throttle.retryAfterMs,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(throttle.retryAfterMs / 1000)),
        },
      },
    );
  }

  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "Admin login is not configured." },
      { status: 500 },
    );
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const password =
    body && typeof body === "object" && "password" in body
      ? String((body as { password: unknown }).password ?? "")
      : "";

  if (password.length === 0 || !safeEqual(password, expected)) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  // Successful login — reset the throttle so a legitimate operator
  // can refresh without burning through their next-minute budget.
  clearLoginAttempts(ip);

  const token = signAdminSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: adminSessionCookieMaxAgeSeconds(),
    domain: adminCookieDomain(req.headers.get("host")),
  });
  return res;
}
