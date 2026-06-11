/**
 * Self-generated OTP store backed by Upstash Redis.
 *
 * We generate a 6-digit code ourselves, send it via MSG91 (see msg91.ts),
 * and verify it here — replacing Twilio Verify's server-side generate+check.
 *
 * Security:
 *   - The plaintext code NEVER touches Redis. We store only an HMAC of the
 *     code (keyed by OTP_SECRET), so a Redis read can't reveal a live OTP.
 *   - TTL 600s (10 minutes) — matches the approved DLT template wording.
 *   - Attempt cap: after MAX_ATTEMPTS wrong guesses the code is burned, so a
 *     6-digit space can't be brute-forced within the window.
 *
 * Reuses the same Upstash credentials as the rate limiter
 * (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).
 */

import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const SECRET = process.env.OTP_SECRET ?? "cadieux_otp_fallback_secret";
const TTL_SECONDS = 600; // 10 minutes
const MAX_ATTEMPTS = 5;

function codeKey(phone: string): string {
  return `otp:code:${phone}`;
}
function attemptsKey(phone: string): string {
  return `otp:attempts:${phone}`;
}

function hashCode(code: string): string {
  return createHmac("sha256", SECRET).update(code).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Cryptographically-random 6-digit code, zero-padded ("000000"–"999999"). */
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * Stores the HMAC of `code` for `phone` with a 600s TTL and resets the
 * attempt counter. A fresh send overwrites any previous unexpired code.
 */
export async function putOtp(phone: string, code: string): Promise<void> {
  await Promise.all([
    redis.set(codeKey(phone), hashCode(code), { ex: TTL_SECONDS }),
    redis.del(attemptsKey(phone)),
  ]);
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "expired" | "invalid" | "too_many_attempts" };

/**
 * Verifies `code` against the stored HMAC for `phone`. Counts attempts and
 * burns the code after MAX_ATTEMPTS. On success the code is consumed
 * (single-use). Constant-time comparison on the hash.
 */
export async function verifyOtp(
  phone: string,
  code: string,
): Promise<VerifyResult> {
  // Count this attempt first so brute-forcers can't get unlimited tries.
  const attempts = await redis.incr(attemptsKey(phone));
  if (attempts === 1) {
    await redis.expire(attemptsKey(phone), TTL_SECONDS);
  }
  if (attempts > MAX_ATTEMPTS) {
    await Promise.all([redis.del(codeKey(phone)), redis.del(attemptsKey(phone))]);
    return { ok: false, reason: "too_many_attempts" };
  }

  const stored = await redis.get<string>(codeKey(phone));
  if (!stored) {
    return { ok: false, reason: "expired" };
  }

  if (!safeEqualHex(stored, hashCode(code))) {
    return { ok: false, reason: "invalid" };
  }

  // Single-use: consume the code and clear the counter on success.
  await Promise.all([redis.del(codeKey(phone)), redis.del(attemptsKey(phone))]);
  return { ok: true };
}
