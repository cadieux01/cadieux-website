// Transactional WhatsApp trigger. Wraps Twilio's WhatsApp sandbox API.
//
// Same auth + rate-limit model as /api/send-sms — see that route for
// the full rationale. In short: admin session OR internal secret OR
// matching verified phone; 3/phone/hr + 10/IP/hr.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin } from "@/lib/admin-auth";
import { hasInternalSecret } from "@/lib/internal-secret";
import { getVerifiedPhone, maskPhone } from "@/lib/phone-cookie";
import { getClientIP, smsIpRateLimit, smsPhoneRateLimit } from "@/lib/ratelimit";
import { parseBody, SendWhatsappSchema } from "@/lib/validation";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const FROM_NUMBER = "whatsapp:+14155238886";

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, SendWhatsappSchema);
  if (!parsed.ok) return parsed.response;
  // Either field name accepted, mirroring the legacy contract.
  const recipientLocal = parsed.data.phone ?? parsed.data.to ?? "";

  const ip = getClientIP(req);
  const isAdminCaller = isAdmin(req);
  const isInternal = hasInternalSecret(req);
  let isPhoneOwner = false;
  if (!isAdminCaller && !isInternal) {
    const verified = getVerifiedPhone(req);
    const verifiedLocal = (verified?.phone ?? "").replace(/\D/g, "").slice(-10);
    isPhoneOwner = verifiedLocal.length === 10 && verifiedLocal === recipientLocal;
  }
  if (!isAdminCaller && !isInternal && !isPhoneOwner) {
    console.warn("[send-whatsapp] unauthorised attempt", {
      ip,
      to: maskPhone(recipientLocal),
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [phoneRl, ipRl] = await Promise.all([
    smsPhoneRateLimit.limit(`wa:${recipientLocal}`),
    smsIpRateLimit.limit(`wa:${ip}`),
  ]);
  if (!phoneRl.success || !ipRl.success) {
    console.warn("[send-whatsapp] rate limit hit", {
      ip,
      to: maskPhone(recipientLocal),
      caller: isAdminCaller ? "admin" : isInternal ? "internal" : "owner",
    });
    return NextResponse.json(
      { error: "Too many WhatsApp requests. Please slow down." },
      { status: 429 },
    );
  }

  const to = `whatsapp:+91${recipientLocal}`;
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
        Body: parsed.data.message,
      }).toString(),
    });
    const respBody = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) {
      const d = respBody as { code?: number | string; message?: string; status?: number };
      console.error("Twilio WhatsApp error", {
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
    console.error("send-whatsapp error", { to: maskPhone(to), err: String(err) });
    return NextResponse.json({ error: "Failed to send WhatsApp" }, { status: 500 });
  }
}
