import { NextRequest, NextResponse } from "next/server";
import { normalizePhone } from "@/lib/phone-cookie";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { otpRateLimit } from "@/lib/ratelimit";
import { generateOtp, putOtp } from "@/lib/otp-store";
import { sendOtpSms } from "@/lib/msg91";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone ?? "");
  const turnstileToken = String(body.turnstileToken ?? "");

  if (!phone) {
    return NextResponse.json({ ok: false, error: "Missing phone" }, { status: 400 });
  }

  const to = normalizePhone(phone);

  // Distributed rate limit: 3 OTP sends per phone per hour (Upstash Redis).
  // Runs before Turnstile so abusive clients can't burn siteverify quota.
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

  // Bot gate: every OTP send must be human-verified via Cloudflare Turnstile.
  const isHuman = await verifyTurnstileToken(turnstileToken);
  if (!isHuman) {
    return NextResponse.json(
      { ok: false, error: "Human verification failed. Please try again." },
      { status: 403 }
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
    console.error("MSG91 send error:", sent.error);
    return NextResponse.json(
      { ok: false, error: "Failed to send code." },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true });
}
