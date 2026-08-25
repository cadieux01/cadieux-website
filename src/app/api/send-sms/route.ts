// Transactional SMS trigger. Wraps Twilio's REST API.
//
// Auth model (any one is sufficient):
//   1. Admin session cookie (operator-triggered manual notifications).
//   2. Verified-phone cookie/bearer that matches the recipient
//      (customer-triggered, e.g. order confirmation after place_order).
//   3. INTERNAL_API_SECRET header (server-to-server calls from other
//      route handlers — mobile checkout, subscription edits, etc).
//
// Rate limits (Upstash, sliding window):
//   - 3 sends per recipient phone per hour
//   - 10 sends per source IP per hour
// Limits run for ALL callers including admin — they protect the Twilio
// budget, not just abuse from the public web.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin } from "@/lib/admin-auth";
import { hasInternalSecret } from "@/lib/internal-secret";
import { getVerifiedPhone, maskPhone } from "@/lib/phone-cookie";
import { getClientIP, smsIpRateLimit, smsPhoneRateLimit } from "@/lib/ratelimit";
import { parseBody, SendSmsSchema } from "@/lib/validation";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER ?? "+17179054294";

/** Converts a validated 10-digit local phone into Twilio's E.164 form. */
function toE164(local10: string): string {
  return `+91${local10}`;
}

type SmsPayload = {
  phone: string;
  name?: string;
  type: "order_placed" | "status_change" | "customer_edit";
  orderId?: string;
  /** Human-facing OLF number. When present, replaces the UUID slice. */
  orderNumber?: string;
  total?: number;
  address?: string;
  status?: string;
  /** Pre-order mode stamp — appends a "date TBD" note to order_placed. */
  preorder?: boolean;
};

/** OLF number (preferred) → falls back to a UUID hex slice so old callers
 *  that only pass orderId still get a recognisable identifier. */
function orderLabel(body: SmsPayload): string {
  const n = body.orderNumber?.trim();
  if (n) return n;
  return "#" + String(body.orderId ?? "").slice(0, 8).toUpperCase();
}

function buildMessage(body: SmsPayload): string | null {
  const name = body.name ?? "Customer";

  if (body.type === "order_placed") {
    const label = orderLabel(body);
    const total = body.total ?? "";
    const address = body.address ?? "";
    const closing = body.preorder
      ? "This is a pre-order. We will confirm your delivery date by SMS + WhatsApp shortly. Thank you!"
      : "We will confirm shortly. Thank you!";
    return (
      `Hi ${name}! Your Cadieux order ${label} has been placed.\n` +
      `Total: Rs.${total}\n` +
      `Delivery to: ${address}\n` +
      closing
    );
  }

  if (body.type === "status_change") {
    const label = orderLabel(body);
    switch (body.status) {
      case "Confirmed":
        return `Hi ${name}! Your Cadieux order ${label} is confirmed. We are preparing your fresh bread.`;
      case "Dispatched":
        return `Hi ${name}! Your Cadieux order ${label} is on the way! Our delivery partner will reach you soon.`;
      case "Delivered":
        return `Hi ${name}! Your Cadieux order ${label} has been delivered! Enjoy your fresh bread. Thank you for choosing Cadieux.`;
      default:
        return null;
    }
  }

  if (body.type === "customer_edit") {
    const address = body.address ?? "";
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
  // ── 1. Validate shape + Indian-phone normalization ────────────────────────
  const parsed = await parseBody(req, SendSmsSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;
  const recipientLocal = data.phone; // 10-digit local, normalised by zod

  // ── 2. Auth: admin session OR internal secret OR matching verified phone ──
  const ip = getClientIP(req);
  const isAdminCaller = isAdmin(req);
  const isInternal = hasInternalSecret(req);
  let isPhoneOwner = false;
  if (!isAdminCaller && !isInternal) {
    const verified = getVerifiedPhone(req);
    // verified.phone may be "+91XXXXXXXXXX" or 10-digit local — compare
    // on the bare last-10 form to be safe across formats.
    const verifiedLocal = (verified?.phone ?? "").replace(/\D/g, "").slice(-10);
    isPhoneOwner = verifiedLocal.length === 10 && verifiedLocal === recipientLocal;
  }
  if (!isAdminCaller && !isInternal && !isPhoneOwner) {
    console.warn("[send-sms] unauthorised attempt", {
      ip,
      to: maskPhone(recipientLocal),
      type: data.type,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 3. Rate limit — phone bucket + IP bucket ──────────────────────────────
  const [phoneRl, ipRl] = await Promise.all([
    smsPhoneRateLimit.limit(`sms:${recipientLocal}`),
    smsIpRateLimit.limit(`sms:${ip}`),
  ]);
  if (!phoneRl.success || !ipRl.success) {
    console.warn("[send-sms] rate limit hit", {
      ip,
      to: maskPhone(recipientLocal),
      caller: isAdminCaller ? "admin" : isInternal ? "internal" : "owner",
      phone_remaining: phoneRl.remaining,
      ip_remaining: ipRl.remaining,
    });
    return NextResponse.json(
      { error: "Too many SMS requests. Please slow down." },
      { status: 429 },
    );
  }

  // ── 4. Build message + ship to Twilio ─────────────────────────────────────
  const message = buildMessage(data);
  if (!message) {
    return NextResponse.json({ error: "Invalid type or status" }, { status: 400 });
  }

  const to = toE164(recipientLocal);
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
    const respBody = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) {
      // Twilio echoes back `to`, `body`, `from` in error responses — never
      // log the raw object. Pull only the diagnostic fields we need.
      const d = respBody as { code?: number | string; message?: string; status?: number };
      console.error("Twilio SMS error", {
        http_status: res.status,
        twilio_code: d.code,
        twilio_status: d.status,
        twilio_message: d.message,
        to: maskPhone(to),
      });
      return NextResponse.json({ error: d.message ?? "Twilio send failed" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, sid: (respBody as { sid?: string }).sid });
  } catch (err) {
    console.error("send-sms error", { to: maskPhone(to), err: String(err) });
    return NextResponse.json({ error: "Failed to send SMS" }, { status: 500 });
  }
}
