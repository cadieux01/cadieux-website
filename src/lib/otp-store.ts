/**
 * In-memory OTP store shared by /api/verify/send and /api/verify/check.
 *
 * Single-instance only — on serverless cold starts the map is empty, so a
 * code issued before a cold start will not validate. For a single Vercel /
 * Node process this is fine and matches the existing rate-limiter pattern.
 * If multi-instance support is ever needed, swap this for Redis or
 * Supabase-backed storage.
 */

type Entry = { code: string; expires: number; attempts: number };

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

declare global {
  var __cadieux_otp_store: Map<string, Entry> | undefined;
}

const store: Map<string, Entry> =
  globalThis.__cadieux_otp_store ?? new Map<string, Entry>();
if (!globalThis.__cadieux_otp_store) globalThis.__cadieux_otp_store = store;

export function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function setOtp(phone: string, code: string): void {
  store.set(phone, { code, expires: Date.now() + TTL_MS, attempts: 0 });
}

export function clearOtp(phone: string): void {
  store.delete(phone);
}

export function checkOtp(phone: string, code: string): { ok: boolean; reason?: string } {
  const entry = store.get(phone);
  if (!entry) return { ok: false, reason: "No code issued. Request a new one." };
  if (Date.now() > entry.expires) {
    store.delete(phone);
    return { ok: false, reason: "Code expired. Request a new one." };
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    store.delete(phone);
    return { ok: false, reason: "Too many attempts. Request a new code." };
  }
  if (entry.code !== code) {
    entry.attempts += 1;
    return { ok: false, reason: "Invalid code." };
  }
  store.delete(phone);
  return { ok: true };
}
