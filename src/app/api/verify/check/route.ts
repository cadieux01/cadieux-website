import { NextRequest, NextResponse } from "next/server";
import {
  PHONE_COOKIE_NAME,
  PHONE_COOKIE_TTL_MS,
  normalizePhone,
  signPhoneCookie,
} from "@/lib/phone-cookie";
import { verifyOtp } from "@/lib/otp-store";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone ?? "");
  const code = String(body.code ?? "").replace(/\D/g, "");

  if (!phone || !code) {
    return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });
  }

  const to = normalizePhone(phone);

  try {
    const result = await verifyOtp(to, code);
    if (!result.ok) {
      if (result.reason === "too_many_attempts") {
        return NextResponse.json(
          { ok: false, error: "Too many attempts. Try again later." },
          { status: 429 }
        );
      }
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
