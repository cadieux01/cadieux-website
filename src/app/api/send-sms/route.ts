import { NextRequest, NextResponse } from "next/server";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER ?? "";

type Status = "Confirmed" | "Dispatched" | "Delivered";

function buildMessage(name: string, status: Status): string {
  switch (status) {
    case "Confirmed":
      return `Hi ${name}, your Cadieux order has been confirmed! We are preparing your bread. 🍞`;
    case "Dispatched":
      return `Hi ${name}, your Cadieux order is on the way! Expected delivery today. 🚚`;
    case "Delivered":
      return `Hi ${name}, your Cadieux order has been delivered! Enjoy your bread. Thank you for choosing Cadieux. 🍞`;
  }
}

function normalizePhone(raw: string): string {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (String(raw).startsWith("+")) return String(raw);
  return `+${digits}`;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone ?? "");
  const name = String(body.name ?? "Customer");
  const status = body.status as Status;

  if (!phone || !["Confirmed", "Dispatched", "Delivered"].includes(status)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM_NUMBER) {
    console.warn("[send-sms] Twilio env vars missing; skipping send.");
    return NextResponse.json({ ok: true, skipped: true });
  }

  const to = normalizePhone(phone);
  const message = buildMessage(name, status);

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
    const data = await res.json();
    if (!res.ok) {
      console.error("Twilio error:", data);
      return NextResponse.json({ error: data.message ?? "Twilio send failed" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, sid: data.sid });
  } catch (err) {
    console.error("send-sms error:", err);
    return NextResponse.json({ error: "Failed to send SMS" }, { status: 500 });
  }
}
