import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

const SECRET = process.env.OTP_SECRET ?? "cadieux_otp_fallback_secret";

function verifyToken(phone: string, otp: string, token: string): boolean {
  try {
    const decoded = Buffer.from(token, "base64url").toString();
    const parts   = decoded.split(":");
    if (parts.length !== 4) return false;
    const [tPhone, tOtp, tExpiry, tSig] = parts;
    if (tPhone !== phone || tOtp !== otp) return false;
    if (Date.now() > parseInt(tExpiry, 10)) return false;
    const expected = createHmac("sha256", SECRET)
      .update(`${tPhone}:${tOtp}:${tExpiry}`)
      .digest("hex");
    return tSig === expected;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone ?? "").replace(/\D/g, "");
  const otp   = String(body.otp   ?? "").replace(/\D/g, "");
  const token = String(body.token ?? "");

  if (!phone || !otp || !token) {
    return NextResponse.json({ success: false, error: "Missing fields" }, { status: 400 });
  }

  const ok = verifyToken(phone, otp, token);
  if (!ok) {
    return NextResponse.json({ success: false, error: "Invalid or expired code" }, { status: 401 });
  }

  return NextResponse.json({ success: true });
}
