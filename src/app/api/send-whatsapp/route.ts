import { NextRequest, NextResponse } from "next/server";
import { maskPhone } from "@/lib/phone-cookie";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const FROM_NUMBER = "whatsapp:+14155238886";

function normalizePhone(raw: string): string {
  const trimmed = String(raw).trim();
  if (trimmed.startsWith("whatsapp:")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `whatsapp:+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `whatsapp:+${digits}`;
  if (trimmed.startsWith("+")) return `whatsapp:${trimmed}`;
  return `whatsapp:+${digits}`;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  // Accept "phone" or "to" for flexibility
  const phone = String(body.phone ?? body.to ?? "");
  const message = String(body.message ?? "");

  if (!phone || !message) {
    return NextResponse.json({ error: "Missing phone or message" }, { status: 400 });
  }

  const to = normalizePhone(phone);
  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: to,
        From: FROM_NUMBER,
        Body: message,
      }).toString(),
    });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) {
      // Twilio echoes back `to`, `body`, `from` — never log `data` directly.
      const d = data as { code?: number | string; message?: string; status?: number };
      console.error("Twilio WhatsApp error", {
        http_status: res.status,
        twilio_code: d.code,
        twilio_status: d.status,
        twilio_message: d.message,
        to: maskPhone(to),
      });
      return NextResponse.json({ error: d.message ?? "Twilio send failed" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, sid: (data as { sid?: string }).sid });
  } catch (err) {
    console.error("send-whatsapp error", { to: maskPhone(to), err: String(err) });
    return NextResponse.json({ error: "Failed to send WhatsApp" }, { status: 500 });
  }
}
