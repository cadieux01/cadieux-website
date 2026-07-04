import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest, NextResponse } from "next/server";

const SECRET = process.env.OTP_SECRET ?? "cadieux_otp_fallback_secret";

export const PHONE_COOKIE_NAME = "cdx_phone_verified";
// Web session lifetime. 7 days chosen so an active customer doesn't get
// re-prompted for OTP on routine actions (Edit delivery date/time, Pay
// Now, address changes). Ownership is still enforced by the HMAC in
// every request — this is only a session length, not a trust widening.
// Each successful WRITE endpoint (see rollPhoneCookieOnWebRequest below)
// also re-issues the cookie with a fresh 7-day expiry, so a customer
// who keeps using the site rolls forward indefinitely.
export const PHONE_COOKIE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — web cookie
export const MOBILE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — mobile bearer

export function signPhoneCookie(phone: string, exp: number): string {
  const payload = `${phone}:${exp}`;
  const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
  return `${payload}:${sig}`;
}

export function verifyPhoneCookie(value: string | undefined): { phone: string; exp: number } | null {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length !== 3) return null;
  const [phone, expStr, sig] = parts;
  const exp = parseInt(expStr, 10);
  if (!phone || !exp) return null;
  if (Date.now() > exp) return null;
  const expected = createHmac("sha256", SECRET).update(`${phone}:${exp}`).digest("hex");
  if (sig !== expected) return null;
  return { phone, exp };
}

/**
 * Resolves the verified phone for a request from EITHER:
 *   1. `Authorization: Bearer <token>` (mobile, 30-day HMAC token)
 *   2. `cdx_phone_verified` cookie (web, 30-min HMAC cookie)
 *
 * Both formats use the exact same signer (`signPhoneCookie`), so a token
 * is just a long-lived cookie value transported over a header. Behaviour
 * for cookie-only callers is unchanged from the previous direct
 * `verifyPhoneCookie(req.cookies.get(PHONE_COOKIE_NAME))` pattern.
 */
export function getVerifiedPhone(
  req: NextRequest
): { phone: string; exp: number } | null {
  // 1. Bearer header (mobile)
  const auth = req.headers.get("authorization");
  if (auth && auth.startsWith("Bearer ")) {
    const result = verifyPhoneCookie(auth.slice(7));
    if (result) return result;
  }

  // 2. Cookie (web)
  const cookieValue = req.cookies.get(PHONE_COOKIE_NAME)?.value;
  if (cookieValue) {
    const result = verifyPhoneCookie(cookieValue);
    if (result) return result;
  }

  return null;
}

/**
 * Rolling session helper. Call at the very end of a SUCCESSFUL web write
 * response to re-issue `cdx_phone_verified` with a fresh 7-day expiry, so
 * an actively-using customer never gets re-prompted for OTP.
 *
 * No-op when:
 *   - request had no cookie (mobile bearer only, or unauth) — mobile
 *     bearer is validated by its own 30-day HMAC and does NOT need a
 *     cookie rewrite
 *   - cookie is invalid/expired — we do NOT resurrect it
 *
 * Same attributes as /api/verify/check (single source of set-cookie config
 * lives inline here + at the two initial-issue sites).
 */
export function rollPhoneCookieOnWebRequest(
  req: NextRequest,
  res: NextResponse
): void {
  const cookieValue = req.cookies.get(PHONE_COOKIE_NAME)?.value;
  if (!cookieValue) return;
  const verified = verifyPhoneCookie(cookieValue);
  if (!verified) return;
  const exp = Date.now() + PHONE_COOKIE_TTL_MS;
  res.cookies.set(PHONE_COOKIE_NAME, signPhoneCookie(verified.phone, exp), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(PHONE_COOKIE_TTL_MS / 1000),
  });
}

/**
 * Constant-time check of an inbound `X-App-Key` header against
 * `MOBILE_APP_KEY`. Returns false (fails closed) if the env var is
 * missing — the calling route should treat that as a 500.
 *
 * MOBILE_APP_KEY is a friction layer, not a real secret: it can be
 * extracted from any compiled mobile bundle. Real abuse protection is
 * the per-phone Upstash rate limit. This check just stops drive-by
 * curl spam against the mobile endpoints.
 */
export function isValidMobileAppKey(presented: string | null): boolean {
  const expected = process.env.MOBILE_APP_KEY;
  if (!expected) return false;
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Normalises a phone number to +91… form. Mirror of normalizePhone in send-sms. */
export function normalizePhone(raw: string): string {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (String(raw).startsWith("+")) return String(raw);
  return `+${digits}`;
}

/** Mask all but the last 4 digits of a phone for safe logging.
 *  "+917093403747" → "+91*******3747", "9876543210" → "******3210" */
export function maskPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = String(raw);
  if (s.length <= 4) return "*".repeat(s.length);
  return s.slice(0, s.length - 4).replace(/\d/g, "*") + s.slice(-4);
}
