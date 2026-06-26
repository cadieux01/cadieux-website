// Server-side PIN grant primitives.
//
// A single 6-digit PIN — the one stored in `website_admin_pin` and managed
// from /admin/profile — governs sensitive product mutations. The flow is:
//   1. The operator types the PIN into the product-page prompt.
//   2. The browser POSTs it to /api/admin/pin { action: "verify" }.
//   3. On success the pin route mints a short-lived, HMAC-signed GRANT
//      token (it never echoes the PIN back) AND sets a matching httpOnly
//      `pin_verified` cookie.
//   4. The browser attaches the grant as the `x-pin-grant` header on the
//      actual product mutation; the mutation route re-verifies the grant
//      (header OR cookie) server-side. A direct API call without a valid
//      grant is rejected.
//
// The HMAC is keyed on ADMIN_TOKEN (already server-only), reusing the same
// signing secret as the admin-session — no new env var is required.

import crypto from "crypto";
import type { NextRequest } from "next/server";

export const PIN_GRANT_COOKIE = "pin_verified";

// A grant is valid for 5 minutes — long enough to make a few edits in one
// sitting without re-entering the PIN, short enough to bound a stolen grant.
const GRANT_TTL_MS = 5 * 60 * 1000;
export const PIN_GRANT_TTL_MS = GRANT_TTL_MS;

function signingSecret(): string {
  // ADMIN_TOKEN is server-only; reuse it as the HMAC key for grants.
  return process.env.ADMIN_TOKEN || "cadieux-pin-grant-unconfigured";
}

function hmac(body: string): string {
  return crypto
    .createHmac("sha256", signingSecret())
    .update(body)
    .digest("base64url");
}

// Issue a signed, time-boxed grant. The payload carries only a purpose tag
// and an expiry — no secret material.
export function signPinGrant(now: number = Date.now()): string {
  const payload = { p: "pin", exp: now + GRANT_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body)}`;
}

// Verify a grant token: signature valid AND not expired AND correct purpose.
export function verifyPinGrantToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(body);
  // Length-guard before timingSafeEqual (it throws on length mismatch).
  if (sig.length !== expected.length) return false;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return false;
    }
  } catch {
    return false;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      p?: string;
      exp?: number;
    };
    return (
      parsed.p === "pin" &&
      typeof parsed.exp === "number" &&
      parsed.exp > Date.now()
    );
  } catch {
    return false;
  }
}

// A request carries a valid grant if the `x-pin-grant` header is valid OR
// the `pin_verified` cookie is valid. Both are accepted so the grant works
// whether it rides as an explicit header (adminFetch) or as the cookie.
export function hasValidPinGrant(req: NextRequest): boolean {
  if (verifyPinGrantToken(req.headers.get("x-pin-grant"))) return true;
  return verifyPinGrantToken(req.cookies.get(PIN_GRANT_COOKIE)?.value);
}

export function pinGrantCookieMaxAgeSeconds(): number {
  return Math.floor(GRANT_TTL_MS / 1000);
}
