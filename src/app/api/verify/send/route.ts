import { NextRequest, NextResponse } from "next/server";
import { normalizePhone } from "@/lib/phone-cookie";
import { sendOTP } from "@/lib/msg91";
import { clearOtp, generateCode, setOtp } from "@/lib/otp-store";

// In-memory rate limiter — 5 sends per phone per 15 min.
// Single-instance only; on serverless cold starts the window resets.
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 5;
const sends = new Map<string, { count: number; windowStart: number }>();

function rateCheck(phone: string): boolean {
  const now = Date.now();
  const entry = sends.get(phone);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    sends.set(phone, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone ?? "");
  if (!phone) {
    return NextResponse.json({ ok: false, error: "Missing phone" }, { status: 400 });
  }

  const to = normalizePhone(phone);

  if (!rateCheck(to)) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Try again later." },
      { status: 429 }
    );
  }

  const code = generateCode();
  setOtp(to, code);

  const result = await sendOTP(to, code);
  if (!result.ok) {
    clearOtp(to);
    console.error("MSG91 OTP send failed:", result.error);
    return NextResponse.json(
      { ok: false, error: result.error || "Failed to send code." },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true });
}
