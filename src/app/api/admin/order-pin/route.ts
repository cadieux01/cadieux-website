// /api/admin/order-pin — manage the ORDER PIN.
//
// This route SETS and RESETS the PIN. It deliberately has no `verify`
// action: verifying happens inside the mutation routes themselves, via
// `requireOrderPin()` on the `x-order-pin` header, so there is no token
// this route could issue and nothing a client could replay. See
// src/lib/order-pin.ts for why that matters.
//
// Actions (POST body { action, ... }):
//   status  -> { exists, locked, lockedUntil }
//   set     -> { pin, answer, currentPin? }
//              First time: pin + answer are both required — a PIN with no
//              security answer would have no reset path. Thereafter
//              currentPin must match, and answer is optional (omit to keep
//              the existing one).
//   reset   -> { answer, newPin } — security-question bypass. The answer is
//              compared against the stored scrypt hash; it exists in no
//              source file and no migration. Rate-limited per IP by a
//              DB-backed guard that fails CLOSED.
//
// `status` and `set` require the admin session. `reset` does not — it is the
// flow for an operator who is locked out — but it is the only unauthenticated
// action and it is the one with the brute-force guard.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin } from "@/lib/admin-auth";
import {
  ORDER_PIN_REGEX,
  audit,
  checkResetAllowed,
  getOrderPin,
  hashAnswer,
  hashPin,
  isLockedNow,
  normaliseAnswer,
  recordResetAttempt,
  upsertOrderPin,
  verifyAnswer,
  verifyCurrentPin,
} from "@/lib/order-pin";
import { getClientIP } from "@/lib/ratelimit";

export const runtime = "nodejs";

type Body = {
  action?: string;
  pin?: string;
  currentPin?: string;
  answer?: string;
  newPin?: string;
};

async function statusPayload() {
  const row = await getOrderPin();
  const locked = row ? isLockedNow(row.locked_until) : false;
  return {
    exists: !!row,
    locked,
    lockedUntil: locked ? row!.locked_until : null,
    updatedAt: row?.updated_at ?? null,
  };
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await statusPayload());
}

export async function POST(req: NextRequest) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action } = body;

  if (action !== "reset" && !isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── status ────────────────────────────────────────────────────────────────
  if (action === "status") {
    return NextResponse.json(await statusPayload());
  }

  // ── set / change ──────────────────────────────────────────────────────────
  if (action === "set") {
    const { pin, currentPin, answer } = body;

    if (!pin || !ORDER_PIN_REGEX.test(pin)) {
      return NextResponse.json(
        { error: "Order PIN must be exactly 6 digits." },
        { status: 400 },
      );
    }

    const existing = await getOrderPin();

    // ── first-time set ──
    if (!existing) {
      const normalised = normaliseAnswer(answer);
      if (normalised.length < 2) {
        return NextResponse.json(
          {
            error:
              "Answer the security question as well — without it there is no way to reset a forgotten PIN.",
          },
          { status: 400 },
        );
      }
      const p = hashPin(pin);
      const a = hashAnswer(normalised);
      const written = await upsertOrderPin({
        pinHash: p.hash,
        pinSalt: p.salt,
        answerHash: a.hash,
        answerSalt: a.salt,
      });
      if (!written.ok) {
        return NextResponse.json({ error: "Could not save the PIN." }, { status: 500 });
      }
      await audit("create", "Order PIN", "Order PIN set for the first time", {
        answer_set: true,
      }, req);
      return NextResponse.json({ ok: true });
    }

    // ── change an existing PIN ──
    if (isLockedNow(existing.locked_until)) {
      const retryAfterMs =
        new Date(existing.locked_until!).getTime() - Date.now();
      return NextResponse.json(
        { error: "Too many incorrect attempts. Try again in a few minutes." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
        },
      );
    }

    if (!currentPin || !ORDER_PIN_REGEX.test(currentPin)) {
      return NextResponse.json(
        { error: "Enter your current order PIN to change it." },
        { status: 400 },
      );
    }

    // A wrong current PIN counts toward the SAME lockout as a wrong PIN at
    // a status change — otherwise this route would be an unlimited oracle
    // for guessing the PIN the status gate protects.
    const currentOk = await verifyCurrentPin(existing, currentPin);
    if (!currentOk.ok) {
      return NextResponse.json(
        { error: currentOk.error },
        {
          status: currentOk.status,
          ...(currentOk.retryAfterMs
            ? {
                headers: {
                  "Retry-After": String(Math.ceil(currentOk.retryAfterMs / 1000)),
                },
              }
            : {}),
        },
      );
    }

    // Answer is optional on change — omit to keep the existing one.
    const normalised = normaliseAnswer(answer);
    const changingAnswer = normalised.length >= 2;
    const nextPin = hashPin(pin);
    const nextAnswer = changingAnswer ? hashAnswer(normalised) : null;

    const written = await upsertOrderPin({
      pinHash: nextPin.hash,
      pinSalt: nextPin.salt,
      answerHash: nextAnswer?.hash ?? existing.answer_hash,
      answerSalt: nextAnswer?.salt ?? existing.answer_salt,
    });
    if (!written.ok) {
      return NextResponse.json({ error: "Could not save the PIN." }, { status: 500 });
    }
    await audit("update", "Order PIN", "Order PIN changed", {
      answer_changed: changingAnswer,
    }, req);
    return NextResponse.json({ ok: true });
  }

  // ── reset (security question) ─────────────────────────────────────────────
  if (action === "reset") {
    const ip = getClientIP(req);

    const guard = await checkResetAllowed(ip);
    if (!guard.allowed) {
      return NextResponse.json(
        { error: "Too many incorrect answers. Try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(guard.retryAfterMs / 1000)) },
        },
      );
    }

    const existing = await getOrderPin();
    if (!existing) {
      // Nothing to reset. Still costs an attempt, so this cannot be used to
      // probe whether a PIN exists without burning the per-IP budget.
      await recordResetAttempt(ip, false);
      return NextResponse.json(
        { error: "Incorrect answer to the security question." },
        { status: 401 },
      );
    }

    const { answer, newPin } = body;

    if (!verifyAnswer(existing, answer)) {
      const lockedUntil = await recordResetAttempt(ip, false);
      if (lockedUntil) {
        await audit(
          "pin_blocked",
          "Order PIN",
          "Order PIN reset locked after 3 incorrect security answers",
          { reason: "reset_locked_out", locked_until: lockedUntil },
          req,
        );
      }
      return NextResponse.json(
        { error: "Incorrect answer to the security question." },
        { status: 401 },
      );
    }

    if (!newPin || !ORDER_PIN_REGEX.test(newPin)) {
      // Correct answer but a malformed PIN — do NOT clear the guard yet,
      // the reset has not actually happened.
      return NextResponse.json(
        { error: "New order PIN must be exactly 6 digits." },
        { status: 400 },
      );
    }

    const p = hashPin(newPin);
    const written = await upsertOrderPin({
      pinHash: p.hash,
      pinSalt: p.salt,
      answerHash: existing.answer_hash,
      answerSalt: existing.answer_salt,
    });
    if (!written.ok) {
      return NextResponse.json({ error: "Could not save the PIN." }, { status: 500 });
    }

    await recordResetAttempt(ip, true);
    await audit(
      "pin_reset",
      "Order PIN",
      "Order PIN reset via the security question",
      { ip },
      req,
    );
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
