// POST /api/team-order/login
//
// Accepts { pin } and, on a constant-time match with TEAM_ORDER_PIN, sets
// an HttpOnly + Secure + SameSite=Lax `team_order_session` cookie signed by
// HMAC-SHA256(ADMIN_TOKEN, payload) with a distinct `p:"team_order"`
// marker. This is a SEPARATE credential from the /admin gate:
//
//   • ADMIN_PASSWORD → the human-typed password on /admin.
//   • TEAM_ORDER_PIN → a short numeric PIN typed on /register. Held only
//     by Sunny's team members. Grants access ONLY to the four order-entry
//     endpoints that explicitly opt in via verifyAdminOrTeamOrder(). It
//     CANNOT satisfy isAdmin() and therefore cannot reach any admin
//     dashboard, mutation, or read outside those four endpoints.
//
// Rate-limited to 5 attempts/minute per IP, keyed under a `team_order:`
// namespace so it does not share a bucket with the admin login.

import { NextRequest, NextResponse } from "next/server";

import { getClientIP } from "@/lib/ratelimit";
import {
  TEAM_ORDER_SESSION_COOKIE,
  adminCookieDomain,
  clearLoginAttempts,
  registerLoginAttempt,
  safeEqual,
  signTeamOrderSession,
  teamOrderSessionCookieMaxAgeSeconds,
} from "@/lib/admin-session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  // Namespaced key so team-order and admin login attempts never share
  // a bucket. An IP burning the admin quota must not deny a team member
  // (and vice-versa).
  const throttleKey = `team_order:${ip}`;
  const throttle = registerLoginAttempt(throttleKey);
  if (!throttle.allowed) {
    return NextResponse.json(
      {
        error: "Too many attempts. Try again shortly.",
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

  const expected = process.env.TEAM_ORDER_PIN;
  if (!expected) {
    return NextResponse.json(
      { error: "Team order link is not configured." },
      { status: 500 },
    );
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const pin =
    body && typeof body === "object" && "pin" in body
      ? String((body as { pin: unknown }).pin ?? "")
      : "";

  if (pin.length === 0 || !safeEqual(pin, expected)) {
    return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
  }

  clearLoginAttempts(throttleKey);

  const token = signTeamOrderSession();
  // Mirror the admin login: return the token in the body too so a
  // client on a host that drops the cookie (Safari ITP across
  // apex→www) can send it as a Bearer header.
  const res = NextResponse.json({ ok: true, token });
  res.cookies.set({
    name: TEAM_ORDER_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: teamOrderSessionCookieMaxAgeSeconds(),
    domain: adminCookieDomain(req.headers.get("host")),
  });
  return res;
}
