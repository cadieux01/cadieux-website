// /api/mobile/verify/send
// Mobile-equivalent of /api/verify/send.
//
// MOBILE_APP_KEY is a FRICTION LAYER, not a real secret. It can be
// extracted from any compiled mobile bundle. Real abuse protection is
// the per-phone Upstash rate limit (3/hr) — shared with the web route via
// the same `ratelimit:otp` prefix so an attacker can't double-dip — and
// the global IP rate limit (30/min) from the API middleware.
// MOBILE_APP_KEY just stops drive-by curl spam.
//
// Future hardening: layer Apple App Attest + Play Integrity here.

import { NextRequest, NextResponse } from "next/server";
import { isValidMobileAppKey, normalizePhone } from "@/lib/phone-cookie";
import { otpRateLimit } from "@/lib/ratelimit";
import { generateOtp, putOtp } from "@/lib/otp-store";
import { sendOtpSms } from "@/lib/msg91";

export async function POST(req: NextRequest) {
  // Fail closed if MOBILE_APP_KEY isn't configured — never accept requests.
  if (!process.env.MOBILE_APP_KEY) {
    return NextResponse.json(
      { ok: false, error: "Server misconfigured" },
      { status: 500 }
    );
  }

  // Friction-layer header check (constant-time).
  const presented = req.headers.get("x-app-key");
  if (!isValidMobileAppKey(presented)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone ?? "");
  if (!phone) {
    return NextResponse.json(
      { ok: false, error: "Missing phone" },
      { status: 400 }
    );
  }

  const to = normalizePhone(phone);

  // ───────── Play review bypass — remove after approval ─────────
  // When REVIEW_TEST_PHONE is set and the caller is that exact number,
  // pretend the SMS was sent. Skips Upstash + Twilio so the reviewer
  // never depends on a real SMS landing. No effect unless the env var
  // is configured.
  const reviewTestPhone = process.env.REVIEW_TEST_PHONE;
  if (reviewTestPhone && to === normalizePhone(reviewTestPhone)) {
    return NextResponse.json({ ok: true });
  }
  // ──────────────────────────────────────────────────────────────

  // Same Upstash key prefix as the web route -> shared 3/hr/phone budget.
  const { success, limit, remaining, reset } = await otpRateLimit.limit(to);
  if (!success) {
    return NextResponse.json(
      {
        ok: false,
        error: "Too many OTP requests. Please try again later.",
        resetAt: new Date(reset).toISOString(),
      },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": limit.toString(),
          "X-RateLimit-Remaining": remaining.toString(),
          "X-RateLimit-Reset": reset.toString(),
        },
      }
    );
  }

  if (!process.env.MSG91_AUTH_KEY || !process.env.MSG91_OTP_TEMPLATE_ID) {
    return NextResponse.json(
      { ok: false, error: "OTP service not configured." },
      { status: 500 }
    );
  }

  // Self-generate a 6-digit code, store its HMAC in Upstash (TTL 600s),
  // then deliver the plaintext via MSG91's DLT-approved template.
  const otp = generateOtp();
  await putOtp(to, otp);

  const sent = await sendOtpSms(to, otp);
  if (!sent.ok) {
    console.error("MSG91 send error (mobile):", sent.error);
    return NextResponse.json(
      { ok: false, error: "Failed to send code." },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true });
}
