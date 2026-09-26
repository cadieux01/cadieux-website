// ORDER PIN — server-side verification for order/subscription status changes.
//
// This is a SECOND PIN, independent of `website_admin_pin`:
//
//                    website_admin_pin          website_order_pin
//   gates            product catalogue edits    status -> confirmed/active/cancelled
//   on success       mints a 5-minute grant     mints NOTHING
//   re-entry         once per 5 minutes         EVERY SINGLE CHANGE
//   lockout          5 attempts / 10 min        3 attempts / 5 min
//
// The "no grant window" rule is the whole point of the design, so there is
// deliberately no token, no cookie and no cache anywhere in this file. The
// PIN travels on the `x-order-pin` header of the mutation request itself and
// is re-hashed and re-compared on every call. If you ever find yourself
// adding a grant here, you are undoing the feature.
//
// Enforcement is SERVER-SIDE. The modal in the admin UI is a convenience:
// the three mutation routes call `requireOrderPin()` before they touch the
// database, so a client that skips the modal gets a 401, not a write.

import crypto from "crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";

// ─── constants ───────────────────────────────────────────────────────────────

export const ORDER_PIN_HEADER = "x-order-pin";

export const ORDER_PIN_REGEX = /^\d{6}$/;

// scrypt params, stated explicitly rather than relying on Node's defaults so
// a future Node release cannot silently change how stored hashes are derived.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_LEN = 32;

// 3 wrong PINs -> 5 minute lockout.
const MAX_PIN_ATTEMPTS = 3;
const PIN_LOCK_MS = 5 * 60 * 1000;

// Reset flow: 3 wrong answers -> 30 minute lockout, per IP.
const MAX_RESET_ATTEMPTS = 3;
const RESET_LOCK_MS = 30 * 60 * 1000;

// The statuses that require the PIN. Orders confirm to "confirmed";
// subscriptions have no "confirmed" status at all — the admin
// confirm-then-activate workflow moves them from pending_confirmation to
// "active", so that is the subscription-side equivalent of a confirm.
export const PIN_GATED_ORDER_STATUSES = new Set(["confirmed", "cancelled"]);
export const PIN_GATED_SUBSCRIPTION_STATUSES = new Set(["active", "cancelled"]);

// Bulk confirm/cancel ceiling. The route's own 200 cap still applies to the
// other bulk actions; these two are money- and customer-visible, so a single
// PIN entry may not authorise more than this many rows.
export const BULK_PIN_MAX = 10;

// ─── hashing ─────────────────────────────────────────────────────────────────

function scryptHash(secret: string, salt: string): string {
  return crypto
    .scryptSync(secret, salt, SCRYPT_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
    .toString("hex");
}

function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

function hashesMatch(candidate: string, stored: string): boolean {
  // timingSafeEqual throws on a length mismatch, so check length first.
  if (candidate.length !== stored.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(stored));
}

// The security answer is a free-text sentence typed by a human months apart,
// so compare it case-insensitively with whitespace collapsed. Anything more
// forgiving than this (stripping punctuation, fuzzy matching) widens the
// guess space for the one credential that can replace the PIN outright.
export function normaliseAnswer(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

export function hashPin(pin: string): { hash: string; salt: string } {
  const salt = generateSalt();
  return { hash: scryptHash(pin, salt), salt };
}

export function hashAnswer(answer: string): { hash: string; salt: string } {
  const salt = generateSalt();
  return { hash: scryptHash(answer, salt), salt };
}

// ─── row access ──────────────────────────────────────────────────────────────

export type OrderPinRow = {
  id: number;
  pin_hash: string;
  pin_salt: string;
  answer_hash: string;
  answer_salt: string;
  failed_attempts: number;
  locked_until: string | null;
  updated_at: string;
};

export function isLockedNow(lockedUntil: string | null): boolean {
  if (!lockedUntil) return false;
  return new Date(lockedUntil).getTime() > Date.now();
}

export async function getOrderPin(): Promise<OrderPinRow | null> {
  const { data } = await supabaseAdmin
    .from("website_order_pin")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  return (data as OrderPinRow | null) ?? null;
}

export async function upsertOrderPin(input: {
  pinHash: string;
  pinSalt: string;
  answerHash: string;
  answerSalt: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabaseAdmin.from("website_order_pin").upsert({
    id: 1,
    pin_hash: input.pinHash,
    pin_salt: input.pinSalt,
    answer_hash: input.answerHash,
    answer_salt: input.answerSalt,
    failed_attempts: 0,
    locked_until: null,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("[order-pin] upsert failed:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

async function clearFailures(): Promise<void> {
  await supabaseAdmin
    .from("website_order_pin")
    .update({ failed_attempts: 0, locked_until: null })
    .eq("id", 1);
}

// Returns the lock expiry if this failure tripped the lockout, else null.
async function registerFailure(row: OrderPinRow): Promise<string | null> {
  const attempts = row.failed_attempts + 1;
  const lockedUntil =
    attempts >= MAX_PIN_ATTEMPTS
      ? new Date(Date.now() + PIN_LOCK_MS).toISOString()
      : null;
  await supabaseAdmin
    .from("website_order_pin")
    .update({ failed_attempts: attempts, locked_until: lockedUntil })
    .eq("id", 1);
  return lockedUntil;
}

// ─── reset guard (per IP, in the DB) ─────────────────────────────────────────

type ResetRow = {
  ip_key: string;
  attempts: number;
  locked_until: string | null;
  last_attempt: string;
};

export async function checkResetAllowed(
  ip: string,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const { data, error } = await supabaseAdmin
    .from("website_order_pin_reset_attempts")
    .select("*")
    .eq("ip_key", ip)
    .maybeSingle();

  // FAIL CLOSED. If the guard cannot be read we do not know how many attempts
  // this IP has already spent, and the whole point of a DB-backed limiter is
  // that it never silently evaporates. Refusing a legitimate reset costs a
  // retry; allowing an unbounded one costs the PIN.
  if (error) {
    console.error("[order-pin] reset guard unreadable — failing closed:", error.message);
    return { allowed: false, retryAfterMs: 60_000 };
  }

  const row = data as ResetRow | null;
  if (row && isLockedNow(row.locked_until)) {
    return {
      allowed: false,
      retryAfterMs: new Date(row.locked_until!).getTime() - Date.now(),
    };
  }

  // Lock expired and the row is older than the window — clear it so the
  // attempt counter starts fresh rather than accumulating forever.
  if (row && Date.now() - new Date(row.last_attempt).getTime() > RESET_LOCK_MS) {
    await supabaseAdmin
      .from("website_order_pin_reset_attempts")
      .delete()
      .eq("ip_key", ip);
  }

  return { allowed: true, retryAfterMs: 0 };
}

// Returns the lock expiry if this attempt tripped the lockout, else null.
export async function recordResetAttempt(
  ip: string,
  success: boolean,
): Promise<string | null> {
  if (success) {
    await supabaseAdmin
      .from("website_order_pin_reset_attempts")
      .delete()
      .eq("ip_key", ip);
    return null;
  }
  const { data } = await supabaseAdmin
    .from("website_order_pin_reset_attempts")
    .select("attempts")
    .eq("ip_key", ip)
    .maybeSingle();
  const attempts = ((data as { attempts: number } | null)?.attempts ?? 0) + 1;
  const lockedUntil =
    attempts >= MAX_RESET_ATTEMPTS
      ? new Date(Date.now() + RESET_LOCK_MS).toISOString()
      : null;
  await supabaseAdmin.from("website_order_pin_reset_attempts").upsert({
    ip_key: ip,
    attempts,
    locked_until: lockedUntil,
    last_attempt: new Date().toISOString(),
  });
  return lockedUntil;
}

/**
 * Check a PIN against the stored hash and count a failure if it is wrong.
 *
 * Used by the "change PIN" flow. It shares the SAME failure counter and
 * lockout as `requireOrderPin` on purpose: if changing the PIN had its own
 * unlimited allowance, that route would be a free oracle for guessing the
 * PIN that the status gate is trying to protect.
 */
export async function verifyCurrentPin(
  row: OrderPinRow,
  pin: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string; retryAfterMs?: number }> {
  if (hashesMatch(scryptHash(pin, row.pin_salt), row.pin_hash)) {
    if (row.failed_attempts > 0 || row.locked_until) await clearFailures();
    return { ok: true };
  }
  const lockedUntil = await registerFailure(row);
  if (lockedUntil) {
    return {
      ok: false,
      status: 429,
      error: "Too many incorrect PINs. Try again in 5 minutes.",
      retryAfterMs: PIN_LOCK_MS,
    };
  }
  return {
    ok: false,
    status: 401,
    error: `Current PIN is incorrect. ${MAX_PIN_ATTEMPTS - (row.failed_attempts + 1)} attempt(s) left before a 5-minute lockout.`,
  };
}

export function verifyAnswer(row: OrderPinRow, rawAnswer: unknown): boolean {
  const answer = normaliseAnswer(rawAnswer);
  if (!answer) return false;
  return hashesMatch(scryptHash(answer, row.answer_salt), row.answer_hash);
}

// ─── the gate ────────────────────────────────────────────────────────────────

export type OrderPinFailure = {
  ok: false;
  status: number;
  code:
    | "order_pin_not_set"
    | "order_pin_required"
    | "order_pin_incorrect"
    | "order_pin_locked";
  error: string;
  retryAfterMs?: number;
};

export type OrderPinResult = { ok: true } | OrderPinFailure;

/**
 * Verify the order PIN carried on this request. Call this BEFORE any write.
 *
 * `subject` is only used for the audit trail — it is the human-readable thing
 * being changed, e.g. "order #1a2b3c4d" or "3 orders (bulk confirm)".
 *
 * Fails CLOSED in every direction: no PIN set, no header, wrong PIN and
 * locked-out all return a failure. There is no configuration under which
 * this returns ok for a request that did not carry a correct PIN.
 */
export async function requireOrderPin(
  req: NextRequest,
  subject: string,
  meta: Record<string, unknown> = {},
): Promise<OrderPinResult> {
  const supplied = req.headers.get(ORDER_PIN_HEADER)?.trim() ?? "";

  const row = await getOrderPin();

  // No PIN configured. Refuse rather than wave the change through — an
  // unconfigured gate that permits everything is the failure mode this
  // feature exists to prevent.
  if (!row) {
    await audit("pin_blocked", subject, "No order PIN is set", {
      ...meta,
      reason: "not_set",
    }, req);
    return {
      ok: false,
      status: 403,
      code: "order_pin_not_set",
      error:
        "No order PIN is set. Set one in Profile before confirming or cancelling.",
    };
  }

  if (isLockedNow(row.locked_until)) {
    const retryAfterMs = new Date(row.locked_until!).getTime() - Date.now();
    return {
      ok: false,
      status: 429,
      code: "order_pin_locked",
      error: "Too many incorrect PINs. Try again in a few minutes.",
      retryAfterMs,
    };
  }

  if (!ORDER_PIN_REGEX.test(supplied)) {
    return {
      ok: false,
      status: 401,
      code: "order_pin_required",
      error: "Enter your 6-digit order PIN to make this change.",
    };
  }

  if (!hashesMatch(scryptHash(supplied, row.pin_salt), row.pin_hash)) {
    const lockedUntil = await registerFailure(row);
    if (lockedUntil) {
      await audit("pin_blocked", subject, "Order PIN locked after 3 incorrect attempts", {
        ...meta,
        reason: "locked_out",
        locked_until: lockedUntil,
      }, req);
      return {
        ok: false,
        status: 429,
        code: "order_pin_locked",
        error: "Too many incorrect PINs. Try again in 5 minutes.",
        retryAfterMs: PIN_LOCK_MS,
      };
    }
    return {
      ok: false,
      status: 401,
      code: "order_pin_incorrect",
      error: `Incorrect PIN. ${MAX_PIN_ATTEMPTS - (row.failed_attempts + 1)} attempt(s) left before a 5-minute lockout.`,
    };
  }

  // Correct. Reset the counter; mint nothing.
  if (row.failed_attempts > 0 || row.locked_until) await clearFailures();
  return { ok: true };
}

/** Turn a failure into the response the mutation route should return. */
export function orderPinErrorResponse(failure: OrderPinFailure): NextResponse {
  const headers: Record<string, string> = {};
  if (failure.retryAfterMs) {
    headers["Retry-After"] = String(Math.ceil(failure.retryAfterMs / 1000));
  }
  return NextResponse.json(
    { error: failure.error, code: failure.code },
    { status: failure.status, headers },
  );
}

// ─── audit ───────────────────────────────────────────────────────────────────

type OrderPinAuditAction = "create" | "update" | "pin_reset" | "pin_blocked";

export async function audit(
  action: OrderPinAuditAction,
  targetLabel: string,
  context: string,
  meta: Record<string, unknown>,
  req?: NextRequest,
): Promise<void> {
  await recordAuditEvent({
    req,
    entity: "order_pin",
    action,
    targetId: null,
    targetLabel,
    context,
    meta,
  });
}
