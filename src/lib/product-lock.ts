// Server-side Product Lock primitives.
//
// The real PRODUCT_LOCK_KEY lives only in the server environment and is
// NEVER shipped to the browser. The flow is:
//   1. The operator types the key into the lock modal.
//   2. The browser POSTs it to /api/admin/verify-product-lock.
//   3. On success the server returns a short-lived, HMAC-signed GRANT
//      token (it does NOT echo the key back).
//   4. The browser attaches the grant as `x-product-lock-grant` on the
//      actual product mutation; the mutation route re-verifies the grant
//      server-side. A direct API call without a valid grant is rejected.
//
// The HMAC is keyed on ADMIN_TOKEN (already server-only), so no extra
// secret is required to sign grants.

import crypto from "crypto";

const GRANT_TTL_MS = 5 * 60 * 1000; // grant valid for 5 minutes
const MAX_ATTEMPTS = 3; // failures before lockout
const LOCKOUT_MS = 5 * 60 * 1000; // 5-minute lockout

export function productLockConfigured(): boolean {
  return Boolean(process.env.PRODUCT_LOCK_KEY);
}

function signingSecret(): string {
  // ADMIN_TOKEN is server-only; reuse it as the HMAC key for grants.
  return process.env.ADMIN_TOKEN || "cadieux-product-lock-unconfigured";
}

// Constant-time comparison of the entered key against PRODUCT_LOCK_KEY.
export function verifyProductKey(key: unknown): boolean {
  const expected = process.env.PRODUCT_LOCK_KEY;
  if (!expected || typeof key !== "string" || key.length === 0) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function hmac(body: string): string {
  return crypto
    .createHmac("sha256", signingSecret())
    .update(body)
    .digest("base64url");
}

// Issue a signed, time-boxed grant. The payload carries only a purpose
// tag and an expiry — no secret material.
export function signGrant(): string {
  const payload = { p: "product-lock", exp: Date.now() + GRANT_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body)}`;
}

// Verify a grant token: signature valid AND not expired.
export function verifyGrant(token: string | null | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = hmac(body);
  // Length-guard before timingSafeEqual (it throws on length mismatch).
  if (sig.length !== expectedSig.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return false;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      p?: string;
      exp?: number;
    };
    return (
      parsed.p === "product-lock" &&
      typeof parsed.exp === "number" &&
      parsed.exp > Date.now()
    );
  } catch {
    return false;
  }
}

// ── lockout tracking ─────────────────────────────────────────────────────
// In-memory, keyed by a caller identifier (IP). This is best-effort: on a
// serverless platform it only spans a single warm instance, but every
// lockout is also written to the audit log for a durable record. The
// server-side grant requirement is the real protection; the lockout is a
// brute-force speed bump on top.

type AttemptState = { fails: number; lockedUntil: number };
const attempts = new Map<string, AttemptState>();

export function isLockedOut(id: string): { locked: boolean; until: number } {
  const s = attempts.get(id);
  if (s && s.lockedUntil > Date.now()) {
    return { locked: true, until: s.lockedUntil };
  }
  return { locked: false, until: 0 };
}

export function registerFailure(id: string): {
  fails: number;
  attemptsLeft: number;
  justLockedOut: boolean;
  lockedUntil: number;
} {
  const now = Date.now();
  const s = attempts.get(id) ?? { fails: 0, lockedUntil: 0 };
  s.fails += 1;
  let justLockedOut = false;
  if (s.fails >= MAX_ATTEMPTS) {
    s.lockedUntil = now + LOCKOUT_MS;
    justLockedOut = true;
  }
  attempts.set(id, s);
  return {
    fails: s.fails,
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - s.fails),
    justLockedOut,
    lockedUntil: s.lockedUntil,
  };
}

export function clearFailures(id: string): void {
  attempts.delete(id);
}

export const PRODUCT_LOCK_LIMITS = { MAX_ATTEMPTS, LOCKOUT_MS, GRANT_TTL_MS };
