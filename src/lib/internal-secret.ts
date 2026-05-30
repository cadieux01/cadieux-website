// Shared secret used to authenticate internal server-to-server calls
// that don't have an admin session or verified-phone cookie attached.
// Example callers: mobile API routes triggering /api/send-sms or
// /api/send-whatsapp after a successful order insert.
//
// Set INTERNAL_API_SECRET in .env.local and the Vercel project. If the
// env var is unset the helper FAILS CLOSED (returns false) so a missing
// rotation can't silently open the SMS endpoint to the world.

import { NextRequest } from "next/server";

const HEADER = "x-internal-secret";

export function internalSecretHeader(): { name: string; value: string } | null {
  const value = process.env.INTERNAL_API_SECRET;
  if (!value) return null;
  return { name: HEADER, value };
}

/** Convenience: returns headers including JSON content-type + the secret
 *  (if configured). Use when posting to /api/send-sms /api/send-whatsapp
 *  from server-side route handlers. */
export function internalJsonHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = process.env.INTERNAL_API_SECRET;
  if (secret) headers[HEADER] = secret;
  return headers;
}

/** Constant-time compare so an attacker can't time-side-channel the secret. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/** True iff the request carries the configured shared secret. */
export function hasInternalSecret(req: NextRequest): boolean {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) return false;
  const supplied = req.headers.get(HEADER) ?? "";
  if (!supplied) return false;
  return safeEqual(supplied, expected);
}
