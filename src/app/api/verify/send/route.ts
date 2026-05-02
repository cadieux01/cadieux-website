import { NextRequest, NextResponse } from "next/server";
import { normalizePhone } from "@/lib/phone-cookie";
import { verifyTurnstileToken } from "@/lib/turnstile";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID ?? "";

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

  if (!rateCheck(to)) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Try again later." },
      { status: 429 }
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
