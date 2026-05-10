import { NextRequest, NextResponse } from "next/server";
import { maskPhone } from "@/lib/phone-cookie";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER ?? "+17179054294";

function normalizePhone(raw: string): string {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (String(raw).startsWith("+")) return String(raw);
  return `+${digits}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildMessage(body: Record<string, any>): string | null {
  const name = String(body.name ?? "Customer");
  const type = String(body.type ?? "");

  if (type === "order_placed") {
    const orderId = String(body.orderId ?? "").slice(0, 8).toUpperCase();
    const total = body.total ?? "";
    const address = body.address ?? "";
    return (
      `Hi ${name}! Your Cadieux order #${orderId} has been placed.\n` +
      `Total: Rs.${total}\n` +
      `Delivery to: ${address}\n` +
      `We will confirm shortly. Thank you!`
    );
  }

  if (type === "status_change") {
    const orderId = String(body.orderId ?? "").slice(0, 8).toUpperCase();
    const status = String(body.status ?? "");
    switch (status) {
      case "Confirmed":
        return `Hi ${name}! Your Cadieux order #${orderId} is confirmed. We are preparing your fresh bread.`;
      case "Dispatched":
        return `Hi ${name}! Your Cadieux order #${orderId} is on the way! Our delivery partner will reach you soon.`;
      case "Delivered":
        return `Hi ${name}! Your Cadieux order #${orderId} has been delivered! Enjoy your fresh bread. Thank you for choosing Cadieux.`;
      default:
        return null;
    }
  }

  if (type === "customer_edit") {
    const address = String(body.address ?? "");
    return (
      `Hi ${name}! Your Cadieux account details have been updated.\n` +
      `Name: ${name}\n` +
      `Address: ${address}\n` +
      `If you did not request this change, contact us immediately.`
    );
  }

  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone ?? "");

  if (!phone) {
    return NextResponse.json({ error: "Missing phone" }, { status: 400 });
  }

  const message = buildMessage(body);
  if (!message) {
    return NextResponse.json({ error: "Invalid type or status" }, { status: 400 });
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
      // Twilio echoes back `to`, `body`, `from` in error responses — never
      // log `data` directly. Pull only the diagnostic fields we need.
      const d = data as { code?: number | string; message?: string; status?: number };
      console.error("Twilio SMS error", {
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
    console.error("send-sms error", { to: maskPhone(to), err: String(err) });
    return NextResponse.json({ error: "Failed to send SMS" }, { status: 500 });
  }
}
