import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

const SECRET  = process.env.OTP_SECRET  ?? "cadieux_otp_fallback_secret";
const API_KEY = process.env.FAST2SMS_KEY ?? "";
const TTL_MS  = 10 * 60 * 1000; // 10 minutes

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function makeToken(phone: string, otp: string): string {
  const expiry = Date.now() + TTL_MS;
  const payload = `${phone}:${otp}:${expiry}`;
  const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const phone: string = String(body.phone ?? "").replace(/\D/g, "");
  if (phone.length !== 10) {
    return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
  }

  const otp   = generateOtp();
  const token = makeToken(phone, otp);

  // If no API key, return the OTP in dev mode (never do this in production)
  if (!API_KEY) {
    console.warn(`[DEV] OTP for ${phone}: ${otp}`);
    return NextResponse.json({ token, dev_otp: otp });
  }

  // Send via Fast2SMS
  try {
    const res = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: {
        "authorization": API_KEY,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        route: "otp",
        variables_values: otp,
        numbers: phone,
      }).toString(),
    });
    const data = await res.json();
    if (!data.return) {
      throw new Error(data.message ?? "SMS send failed");
    }
  } catch (err) {
    console.error("Fast2SMS error:", err);
    return NextResponse.json({ error: "Could not send OTP. Please try again." }, { status: 502 });
  }

  return NextResponse.json({ token });
}
