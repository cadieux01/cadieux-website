import { NextRequest, NextResponse } from "next/server";
import {
  PHONE_COOKIE_NAME,
  PHONE_COOKIE_TTL_MS,
  normalizePhone,
  signPhoneCookie,
} from "@/lib/phone-cookie";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID ?? "";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone ?? "");
  const code = String(body.code ?? "").replace(/\D/g, "");

  if (!phone || !code) {
    return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });
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
      return NextResponse.json({ ok: false, error: "Invalid code." }, { status: 401 });
    }

    const exp = Date.now() + PHONE_COOKIE_TTL_MS;
    const cookieValue = signPhoneCookie(to, exp);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(PHONE_COOKIE_NAME, cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(PHONE_COOKIE_TTL_MS / 1000),
    });
    return response;
  } catch (err) {
    console.error("verify/check error:", err);
    return NextResponse.json({ ok: false, error: "Verification failed." }, { status: 500 });
  }
}
