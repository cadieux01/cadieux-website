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

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID ?? "";

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

  if (!SERVICE_SID || !ACCOUNT_SID || !AUTH_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "OTP service not configured." },
      { status: 500 }
    );
  }

  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64");
  const url = `https://verify.twilio.com/v2/Services/${SERVICE_SID}/Verifications`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, Channel: "sms" }).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) {
      return NextResponse.json(
        { ok: false, error: "Too many attempts. Try again later." },
        { status: 429 }
      );
    }
    if (!res.ok) {
      console.error("Twilio Verify send error (mobile):", data);
      return NextResponse.json(
        { ok: false, error: data.message ?? "Failed to send code." },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("mobile/verify/send error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to send code." },
      { status: 500 }
    );
  }
}
