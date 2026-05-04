import { NextRequest, NextResponse } from "next/server";
import { normalizePhone } from "@/lib/phone-cookie";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { otpRateLimit } from "@/lib/ratelimit";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID ?? "";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone ?? "");
  const turnstileToken = String(body.turnstileToken ?? "");

  if (!phone) {
    return NextResponse.json({ ok: false, error: "Missing phone" }, { status: 400 });
  }

  // Bot gate: every OTP send must be human-verified via Cloudflare Turnstile.
  const isHuman = await verifyTurnstileToken(turnstileToken);
  if (!isHuman) {
    return NextResponse.json(
      { ok: false, error: "Human verification failed. Please try again." },
      { status: 403 }
    );
  }

  if (!SERVICE_SID || !ACCOUNT_SID || !AUTH_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "OTP service not configured." },
      { status: 500 }
    );
  }

  const to = normalizePhone(phone);

  // Distributed rate limit: 3 OTP sends per phone per hour (Upstash Redis).
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
      console.error("Twilio Verify send error:", data);
      return NextResponse.json(
        { ok: false, error: data.message ?? "Failed to send code." },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("verify/send error:", err);
    return NextResponse.json({ ok: false, error: "Failed to send code." }, { status: 500 });
  }
}
