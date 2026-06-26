// POST /api/admin/pin
//
// Manages the website super-admin security PIN. All actions require the
// existing admin password session (isAdmin check) EXCEPT the
// `reset` action which accepts a security-question answer instead
// (checked server-side — the plaintext answer never appears in client JS).
//
// Actions (in POST body { action, ... }):
//   status          → { exists, locked, lockedUntil? }
//   generate        → generates a random 6-digit PIN, hashes + stores, returns { pin } ONCE
//   set             → { pin, currentPin? } set a chosen 6-digit PIN
//                     if a PIN already exists currentPin must match first
//   verify          → { pin } → { ok } — for future gating of sensitive ops
//   reset           → { answer, newPin } — security-question bypass;
//                     answer must equal "sylesh" (server-side check, rate-limited)
//
// PIN is stored as scrypt(pin, salt) — never plaintext.
// Security answer is a compile-time constant checked server-side; it is
// NOT in any client bundle.

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/admin-auth";
import { isAdmin } from "@/lib/admin-auth";
import { adminCookieDomain } from "@/lib/admin-session";
import {
  PIN_GRANT_COOKIE,
  pinGrantCookieMaxAgeSeconds,
  signPinGrant,
} from "@/lib/pin-grant";
import { getClientIP } from "@/lib/ratelimit";

export const runtime = "nodejs";

// ─── constants ────────────────────────────────────────────────────────────────

const PIN_REGEX = /^\d{6}$/;

// scrypt params (N=16384, r=8, p=1 is the Node default but we be explicit).
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_LEN = 32; // 32-byte output → 64 hex chars

// Lock the PIN after 5 wrong attempts for 10 minutes.
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MS = 10 * 60 * 1000;

// Reset-flow (security question): 3 wrong answers → 30-minute lockout per IP.
const MAX_RESET_ATTEMPTS = 3;
const RESET_LOCK_MS = 30 * 60 * 1000;

// The security-answer constant. Server-side only — never reaches the client.
const SECURITY_ANSWER = "sylesh";

// ─── helpers ──────────────────────────────────────────────────────────────────

function hashPin(pin: string, salt: string): string {
  return crypto
    .scryptSync(pin, salt, SCRYPT_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
    .toString("hex");
}

function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

function generateRandomPin(): string {
  // Uniform 6-digit PIN (000000–999999) via rejection sampling so there's
  // no modulo bias.
  while (true) {
    const n = crypto.randomInt(0, 1_000_000);
    return n.toString().padStart(6, "0");
  }
}

function isLockedNow(lockedUntil: string | null): boolean {
  if (!lockedUntil) return false;
  return new Date(lockedUntil).getTime() > Date.now();
}

// ─── DB helpers (single-row table) ────────────────────────────────────────────

type PinRow = {
  id: number;
  pin_hash: string;
  salt: string;
  failed_attempts: number;
  locked_until: string | null;
  updated_at: string;
};

async function getPin(): Promise<PinRow | null> {
  const { data } = await supabaseAdmin
    .from("website_admin_pin")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  return data as PinRow | null;
}

async function upsertPin(pinHash: string, salt: string): Promise<void> {
  await supabaseAdmin.from("website_admin_pin").upsert({
    id: 1,
    pin_hash: pinHash,
    salt,
    failed_attempts: 0,
    locked_until: null,
    updated_at: new Date().toISOString(),
  });
}

async function incrementPinFailures(current: PinRow): Promise<void> {
  const newAttempts = current.failed_attempts + 1;
  const lockedUntil =
    newAttempts >= MAX_PIN_ATTEMPTS
      ? new Date(Date.now() + PIN_LOCK_MS).toISOString()
      : null;
  await supabaseAdmin
    .from("website_admin_pin")
    .update({
      failed_attempts: newAttempts,
      locked_until: lockedUntil,
    })
    .eq("id", 1);
}

async function clearPinFailures(): Promise<void> {
  await supabaseAdmin
    .from("website_admin_pin")
    .update({ failed_attempts: 0, locked_until: null })
    .eq("id", 1);
}

// ─── reset-attempt rate limiter (per IP, in DB) ───────────────────────────────

type ResetRow = {
  ip_key: string;
  attempts: number;
  locked_until: string | null;
  last_attempt: string;
};

async function checkResetAllowed(ip: string): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const { data } = await supabaseAdmin
    .from("website_admin_pin_reset_attempts")
    .select("*")
    .eq("ip_key", ip)
    .maybeSingle();
  const row = data as ResetRow | null;

  if (row && row.locked_until && isLockedNow(row.locked_until)) {
    const retryAfterMs = new Date(row.locked_until).getTime() - Date.now();
    return { allowed: false, retryAfterMs };
  }

  // Auto-clear stale rows older than the lock window.
  if (row && !isLockedNow(row.locked_until)) {
    const age = Date.now() - new Date(row.last_attempt).getTime();
    if (age > RESET_LOCK_MS) {
      await supabaseAdmin
        .from("website_admin_pin_reset_attempts")
        .delete()
        .eq("ip_key", ip);
      return { allowed: true, retryAfterMs: 0 };
    }
  }

  return { allowed: true, retryAfterMs: 0 };
}

async function recordResetAttempt(ip: string, success: boolean): Promise<void> {
  if (success) {
    await supabaseAdmin
      .from("website_admin_pin_reset_attempts")
      .delete()
      .eq("ip_key", ip);
    return;
  }
  const { data } = await supabaseAdmin
    .from("website_admin_pin_reset_attempts")
    .select("attempts")
    .eq("ip_key", ip)
    .maybeSingle();
  const current = (data as { attempts: number } | null)?.attempts ?? 0;
  const newAttempts = current + 1;
  const lockedUntil =
    newAttempts >= MAX_RESET_ATTEMPTS
      ? new Date(Date.now() + RESET_LOCK_MS).toISOString()
      : null;
  await supabaseAdmin.from("website_admin_pin_reset_attempts").upsert({
    ip_key: ip,
    attempts: newAttempts,
    locked_until: lockedUntil,
    last_attempt: new Date().toISOString(),
  });
}

// ─── route handler ─────────────────────────────────────────────────────────────

type Body = {
  action?: string;
  pin?: string;
  currentPin?: string;
  answer?: string;
  newPin?: string;
};

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pin = await getPin();
  const locked = pin ? isLockedNow(pin.locked_until) : false;
  return NextResponse.json({
    exists: !!pin,
    locked,
    lockedUntil: locked ? pin!.locked_until : null,
  });
}

export async function POST(req: NextRequest) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action } = body;

  // `reset` uses the security-question answer instead of admin password.
  // All other actions require the admin session.
  if (action !== "reset" && !isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── status ──────────────────────────────────────────────────────────────────
  if (action === "status") {
    const pin = await getPin();
    const locked = pin ? isLockedNow(pin.locked_until) : false;
    return NextResponse.json({
      exists: !!pin,
      locked,
      lockedUntil: locked ? pin!.locked_until : null,
    });
  }

  // ── generate ─────────────────────────────────────────────────────────────────
  if (action === "generate") {
    const plainPin = generateRandomPin();
    const salt = generateSalt();
    const hash = hashPin(plainPin, salt);
    await upsertPin(hash, salt);
    // PIN is returned ONCE to the client; after this it is irretrievable.
    return NextResponse.json({ ok: true, pin: plainPin });
  }

  // ── set ───────────────────────────────────────────────────────────────────────
  if (action === "set") {
    const { pin, currentPin } = body;
    if (!pin || !PIN_REGEX.test(pin)) {
      return NextResponse.json(
        { error: "PIN must be exactly 6 digits." },
        { status: 400 },
      );
    }

    const existing = await getPin();
    if (existing) {
      // Locked?
      if (isLockedNow(existing.locked_until)) {
        const retryAfterMs = new Date(existing.locked_until!).getTime() - Date.now();
        return NextResponse.json(
          { error: "Too many incorrect attempts. Try again later." },
          { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
        );
      }
      // Require current PIN to change.
      if (!currentPin) {
        return NextResponse.json(
          { error: "Current PIN required to change an existing PIN." },
          { status: 400 },
        );
      }
      const currentHash = hashPin(currentPin, existing.salt);
      const match =
        currentHash.length === existing.pin_hash.length &&
        crypto.timingSafeEqual(Buffer.from(currentHash), Buffer.from(existing.pin_hash));
      if (!match) {
        await incrementPinFailures(existing);
        return NextResponse.json({ error: "Current PIN is incorrect." }, { status: 401 });
      }
    }

    const salt = generateSalt();
    const hash = hashPin(pin, salt);
    await upsertPin(hash, salt);
    return NextResponse.json({ ok: true });
  }

  // ── verify ────────────────────────────────────────────────────────────────────
  if (action === "verify") {
    const { pin } = body;
    if (!pin || !PIN_REGEX.test(pin)) {
      return NextResponse.json({ ok: false, error: "Invalid PIN format." }, { status: 400 });
    }
    const existing = await getPin();
    if (!existing) {
      return NextResponse.json({ ok: false, error: "No PIN set." }, { status: 404 });
    }
    if (isLockedNow(existing.locked_until)) {
      const retryAfterMs = new Date(existing.locked_until!).getTime() - Date.now();
      return NextResponse.json(
        { ok: false, error: "Account locked. Try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } },
      );
    }
    const hash = hashPin(pin, existing.salt);
    const match =
      hash.length === existing.pin_hash.length &&
      crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(existing.pin_hash));
    if (match) {
      await clearPinFailures();
      // Mint a short-lived grant for sensitive mutations (e.g. product
      // edits) and mirror it into an httpOnly cookie. The grant is the
      // single source of truth — it is keyed to this same PIN row.
      const grant = signPinGrant();
      const res = NextResponse.json({ ok: true, grant });
      res.cookies.set(PIN_GRANT_COOKIE, grant, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: pinGrantCookieMaxAgeSeconds(),
        domain: adminCookieDomain(req.headers.get("host")),
      });
      return res;
    }
    await incrementPinFailures(existing);
    return NextResponse.json({ ok: false, error: "Incorrect PIN." }, { status: 401 });
  }

  // ── reset (security-question bypass) ─────────────────────────────────────────
  if (action === "reset") {
    const ip = getClientIP(req);

    // Rate-limit the reset flow independently of the PIN verify flow.
    const rateLimitCheck = await checkResetAllowed(ip);
    if (!rateLimitCheck.allowed) {
      return NextResponse.json(
        { error: "Too many incorrect answers. Try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateLimitCheck.retryAfterMs / 1000)) },
        },
      );
    }

    const { answer, newPin } = body;

    // Security answer check — server-side, never in client JS.
    const trimmedAnswer = typeof answer === "string" ? answer.trim().toLowerCase() : "";
    if (trimmedAnswer !== SECURITY_ANSWER) {
      await recordResetAttempt(ip, false);
      return NextResponse.json(
        { error: "Incorrect answer to security question." },
        { status: 401 },
      );
    }

    if (!newPin || !PIN_REGEX.test(newPin)) {
      return NextResponse.json(
        { error: "New PIN must be exactly 6 digits." },
        { status: 400 },
      );
    }

    await recordResetAttempt(ip, true); // Clear rate-limit on success.
    const salt = generateSalt();
    const hash = hashPin(newPin, salt);
    await upsertPin(hash, salt);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
