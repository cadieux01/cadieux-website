import { NextRequest, NextResponse } from "next/server";
import { normalizePhone, maskPhone } from "@/lib/phone-cookie";
import {
  adminResetPhoneRateLimit,
  adminResetIpRateLimit,
  getClientIP,
} from "@/lib/ratelimit";
import { generateOtp, putOtp } from "@/lib/otp-store";
import { sendOtpSms } from "@/lib/msg91";
import { resolveActiveAdminByPhone, resetOtpKey } from "@/lib/admin-reset";
import { logLogisticsAudit } from "@/lib/logistics-audit";

// POST /api/admin/reset/start  { phone }
//
// Step 1 of the super-admin "Forgot password" flow. Sends an SMS OTP ONLY
// when the phone belongs to an ACTIVE admin — but ALWAYS returns the same
// generic 200 so a caller can't learn whether a number is registered.
//
// Abuse controls: 3 sends/hour per phone AND 3/hour per IP (either trips a
// generic 429). The OTP itself is a 10-min single-use code (otp-store).

const GENERIC_OK = {
  ok: true,
  message: "If this number is registered, you'll receive a code.",
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone ?? "");
  if (!phone) {
    return NextResponse.json({ ok: false, error: "Missing phone" }, { status: 400 });
  }

  const to = normalizePhone(phone);
  const ip = getClientIP(req);

  // Rate-limit both vectors. Keyed on the normalised phone and the client
  // IP. A trip on either returns a generic 429 (no existence disclosure).
  const [phoneLimit, ipLimit] = await Promise.all([
    adminResetPhoneRateLimit.limit(to),
    adminResetIpRateLimit.limit(ip),
  ]);
  if (!phoneLimit.success || !ipLimit.success) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Please try again later." },
      { status: 429 },
    );
  }

  if (!process.env.MSG91_AUTH_KEY || !process.env.MSG91_OTP_TEMPLATE_ID) {
    // Fail generic so the client UX is unchanged; log for operators.
    console.error("[admin/reset/start] MSG91 not configured");
    return NextResponse.json(GENERIC_OK);
  }

  const admin = await resolveActiveAdminByPhone(to);

  if (!admin) {
    // Unknown / non-admin number. Audit the probe (best-effort) but reply
    // generically so we never confirm or deny the number.
    void logLogisticsAudit({
      actionType: "BLOCKED",
      entityType: "admin_password_reset",
      category: "security",
      description: `Reset requested for non-admin number ${maskPhone(to)}`,
      metadata: { step: "start", outcome: "no_match", ip },
    });
    return NextResponse.json(GENERIC_OK);
  }

  // Real active admin — generate + store + send the OTP under the namespaced
  // reset key (isolated from any customer OTP for the same number).
  const otp = generateOtp();
  await putOtp(resetOtpKey(to), otp);
  const sent = await sendOtpSms(to, otp);

  void logLogisticsAudit({
    actionType: sent.ok ? "UPDATE" : "BLOCKED",
    entityType: "admin_password_reset",
    entityId: admin.id,
    category: "security",
    description: sent.ok
      ? `Reset OTP sent to admin ${maskPhone(to)}`
      : `Reset OTP send FAILED for admin ${maskPhone(to)}`,
    metadata: { step: "start", outcome: sent.ok ? "otp_sent" : "send_failed", ip },
  });

  // Even on send failure, keep the response generic (don't leak delivery state).
  return NextResponse.json(GENERIC_OK);
}
