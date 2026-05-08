// /api/mobile/verify/check
// Mobile-equivalent of /api/verify/check.
//
// Returns the HMAC token in the JSON body — NO Set-Cookie. App stores
// the token in AsyncStorage and sends it as `Authorization: Bearer …`
// on subsequent calls. Token TTL = 30 days (vs. 30 min for web cookie);
// signing uses the exact same `signPhoneCookie` so cookies and bearer
// tokens are interchangeable on the server side via `getVerifiedPhone`.
//
// MOBILE_APP_KEY is a friction layer, not a real secret. See the matching
// note in /api/mobile/verify/send.

import { NextRequest, NextResponse } from "next/server";
import {
  MOBILE_TOKEN_TTL_MS,
  isValidMobileAppKey,
  normalizePhone,
  signPhoneCookie,
} from "@/lib/phone-cookie";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID ?? "";

export async function POST(req: NextRequest) {
  if (!process.env.MOBILE_APP_KEY) {
    return NextResponse.json(
      { ok: false, error: "Server misconfigured" },
      { status: 500 }
    );
  }

  const presented = req.headers.get("x-app-key");
  if (!isValidMobileAppKey(presented)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone ?? "");
  const code = String(body.code ?? "").replace(/\D/g, "");

  if (!phone || !code) {
    return NextResponse.json(
      { ok: false, error: "Missing fields" },
      { status: 400 }
    );
  }
  if (!SERVICE_SID || !ACCOUNT_SID || !AUTH_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "OTP service not configured." },
      { status: 500 }
    );
  }

  const to = normalizePhone(phone);
  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64");
  const url = `https://verify.twilio.com/v2/Services/${SERVICE_SID}/VerificationCheck`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, Code: code }).toString(),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.status !== "approved") {
      return NextResponse.json(
        { ok: false, error: "Invalid code." },
        { status: 401 }
      );
    }

    const exp = Date.now() + MOBILE_TOKEN_TTL_MS;
    const token = signPhoneCookie(to, exp);
    return NextResponse.json({ ok: true, token, exp });
  } catch (err) {
    console.error("mobile/verify/check error:", err);
    return NextResponse.json(
      { ok: false, error: "Verification failed." },
      { status: 500 }
    );
  }
}
