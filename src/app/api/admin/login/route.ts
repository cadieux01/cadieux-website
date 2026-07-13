// POST /api/admin/login
//
// Accepts { password } and, on a constant-time match with ADMIN_PASSWORD,
// sets an HttpOnly + Secure + SameSite=Strict `admin_session` cookie
// signed by HMAC-SHA256(ADMIN_TOKEN, payload).
//
// TWO ENV VARS, TWO ROLES — do not confuse them:
//   • ADMIN_PASSWORD → the human-typed password on the /admin gate.
//     Only this route reads it, and only for the compare below.
//   • ADMIN_TOKEN    → the HMAC signing key for admin_session tokens
//     (see src/lib/admin-session.ts) and PIN grants (src/lib/pin-grant.ts).
//     Same key is held by the Supabase dashboard-admin-bridge Edge function
//     — rotating it there without matching here (and vice-versa) breaks the
//     dashboard bridge. It is NEVER used as a password.
//
// Backwards-compat: if ADMIN_PASSWORD is unset we fall back to ADMIN_TOKEN
// with a warning so a deploy that ships before the new env var is
// configured does not lock the operator out. Once ADMIN_PASSWORD is set in
// Vercel the fallback is inert, and rotating ADMIN_TOKEN will never change
// the /admin password again.
//
// Rate-limited to 5 attempts/minute per IP.

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

  // ADMIN_PASSWORD is the human-typed gate password. Fall back to
  // ADMIN_TOKEN (the legacy conflated value) if the new var is unset so
  // an operator is not locked out during the env-var rollout. Once
  // ADMIN_PASSWORD is set in Vercel this fallback is inert.
  let expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    expected = process.env.ADMIN_TOKEN;
    if (expected) {
      console.warn(
        "[admin/login] ADMIN_PASSWORD not set — falling back to ADMIN_TOKEN. " +
          "Set ADMIN_PASSWORD in Vercel and redeploy so the /admin password " +
          "is decoupled from the HMAC signing key.",
      );
    }
  }
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
  // Return the signed session token in the body too (not just Set-Cookie).
  // Safari ITP drops the cookie across the cadieux.in -> www redirect, so
  // the client stores this token and sends it as a Bearer header. It is a
  // 24h HMAC-signed session proof — it does NOT contain the password.
  const res = NextResponse.json({ ok: true, token });
  res.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: adminSessionCookieMaxAgeSeconds(),
    domain: adminCookieDomain(req.headers.get("host")),
  });
  return res;
}
