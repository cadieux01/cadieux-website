import { NextRequest, NextResponse } from "next/server";
import { normalizePhone } from "@/lib/phone-cookie";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { otpRateLimit, getClientIP } from "@/lib/ratelimit";
import { generateOtp, putOtp } from "@/lib/otp-store";
import { sendOtpSms } from "@/lib/msg91";
import { otpAuditMeta, logOtpSend } from "@/lib/otp-audit";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone ?? "");
  const turnstileToken = String(body.turnstileToken ?? "");

  if (!phone) {
    return NextResponse.json({ ok: false, error: "Missing phone" }, { status: 400 });
  }

  const to = normalizePhone(phone);
  const meta = otpAuditMeta(req, getClientIP(req), "web");

  // Bot gate FIRST. This used to run AFTER the rate limit, which meant a
  // request carrying a junk token still consumed one of that phone's
  // three hourly slots — three junk POSTs could lock a real buyer out of
  // checkout for an hour. A slot is now only ever spent by a caller that
  // has already proved it is human.
  const isHuman = await verifyTurnstileToken(turnstileToken);
  if (!isHuman) {
    logOtpSend("BLOCKED", to, { ...meta, outcome: "turnstile_failed" });
    return NextResponse.json(
      { ok: false, error: "Human verification failed. Please try again." },
      { status: 403 }
    );
  }

  // Distributed rate limit: 3 OTP sends per phone per hour (Upstash Redis).
  const { success, limit, remaining, reset } = await otpRateLimit.limit(to);
  if (!success) {
    logOtpSend("BLOCKED", to, { ...meta, outcome: "rate_limited" });
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
    console.error("MSG91 send error:", sent.error);
    logOtpSend("BLOCKED", to, {
      ...meta,
      outcome: "send_failed",
      error: sent.error,
    });
    return NextResponse.json(
      { ok: false, error: "Failed to send code." },
      { status: 502 }
    );
  }
  logOtpSend("CREATE", to, { ...meta, outcome: "sent" });
  return NextResponse.json({ ok: true });
}
