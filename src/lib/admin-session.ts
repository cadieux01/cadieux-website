// Server-side admin session — HTTP-only signed cookie.
//
// Replaces the legacy x-admin-token header (which required shipping
// ADMIN_TOKEN to the browser bundle). The operator POSTs the password
// to /api/admin/login; on success we set `admin_session` — an
// HttpOnly, Secure, SameSite=Strict cookie carrying an HMAC-signed
// payload `{p:"admin", exp:<epoch-ms>}`. The HMAC is keyed on
// ADMIN_TOKEN (server-only).
//
// All admin API routes call verifyAdminSession(req); the helper reads
// the cookie, re-derives the HMAC, and rejects expired or tampered
// tokens. There is no other accepted credential — the legacy
// x-admin-token header is no longer honoured on /api/admin/*.

import crypto from "crypto";
import type { NextRequest } from "next/server";

export const ADMIN_SESSION_COOKIE = "admin_session";

// 24h sliding window. Long enough to outlast a single ops day, short
// enough that a stolen cookie's blast radius stays bounded.
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function signingSecret(): string {
  // Server-only signing key.
  return process.env.ADMIN_TOKEN || "cadieux-admin-session-unconfigured";
}

function hmac(body: string): string {
  return crypto
    .createHmac("sha256", signingSecret())
    .update(body)
    .digest("base64url");
}

export function signAdminSession(now: number = Date.now()): string {
  const payload = { p: "admin", exp: now + SESSION_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body)}`;
}

export function verifyAdminSessionToken(
  token: string | null | undefined,
): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(body);
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
      parsed.p === "admin" &&
      typeof parsed.exp === "number" &&
      parsed.exp > Date.now()
    );
  } catch {
    return false;
  }
}

export function verifyAdminSession(req: NextRequest): boolean {
  const token = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  return verifyAdminSessionToken(token);
}

export function adminSessionCookieMaxAgeSeconds(): number {
  return Math.floor(SESSION_TTL_MS / 1000);
}

// Cookie domain for the admin session.
//
// Production serves the admin from both the apex (`cadieux.in`) and
// `www.cadieux.in`, and the host 307-redirects apex → www. A host-only
// cookie set on one of those hosts is NOT sent to the other, so the
// login POST could succeed at the API level while the session silently
// failed to apply on the page's host. Scoping the cookie to the
// registrable domain (`.cadieux.in`) makes it valid on apex AND www.
//
// On localhost / Vercel preview hosts we return undefined so the cookie
// stays host-only (a `.cadieux.in` domain would be rejected there).
export function adminCookieDomain(
  host: string | null | undefined,
): string | undefined {
  if (!host) return undefined;
  const h = host.split(":")[0].toLowerCase();
  if (h === "cadieux.in" || h.endsWith(".cadieux.in")) return ".cadieux.in";
  return undefined;
}

// ── login throttle ─────────────────────────────────────────────────────
// In-memory sliding window: 5 attempts per minute per IP. Best-effort
// (per warm instance), enough to make password guessing painful. The
// audit log still records every failure for a durable trail.

const WINDOW_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const attempts = new Map<string, number[]>();

export function registerLoginAttempt(ip: string): {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
} {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const prior = (attempts.get(ip) ?? []).filter((t) => t > cutoff);
  if (prior.length >= MAX_ATTEMPTS) {
    const oldest = prior[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, oldest + WINDOW_MS - now),
    };
  }
  prior.push(now);
  attempts.set(ip, prior);
  return {
    allowed: true,
    remaining: Math.max(0, MAX_ATTEMPTS - prior.length),
    retryAfterMs: 0,
  };
}

export function clearLoginAttempts(ip: string): void {
  attempts.delete(ip);
}

// Constant-time string comparison for the password check.
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
