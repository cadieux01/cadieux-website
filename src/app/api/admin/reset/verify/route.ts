import { NextRequest, NextResponse } from "next/server";
import { normalizePhone, maskPhone } from "@/lib/phone-cookie";
import {
  adminResetVerifyRateLimit,
  adminResetIpRateLimit,
  getClientIP,
} from "@/lib/ratelimit";
import { verifyOtp } from "@/lib/otp-store";
import { supabaseAdmin } from "@/lib/admin-auth";
import {
  resolveActiveAdminByPhone,
  resetOtpKey,
  validateNewPassword,
} from "@/lib/admin-reset";
import { logLogisticsAudit } from "@/lib/logistics-audit";

// POST /api/admin/reset/verify  { phone, code, newPassword }
//
// Step 2 of the super-admin "Forgot password" flow. Verifies the SMS OTP
// and, on success, sets a new password on the admin's auth.users row via
// the service role. Every attempt (success + failure) is audit-logged.
//
// Controls: verify calls are rate-limited (10/hr per phone, 3/hr per IP);
// the OTP itself is single-use and burns after 5 wrong guesses (otp-store);
// the new password must meet a minimum strength requirement.

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone ?? "");
  const code = String(body.code ?? "").replace(/\D/g, "");
  const newPassword = String(body.newPassword ?? "");

  if (!phone || !code || !newPassword) {
    return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });
  }

  const to = normalizePhone(phone);
  const ip = getClientIP(req);

  const [verifyLimit, ipLimit] = await Promise.all([
    adminResetVerifyRateLimit.limit(to),
    adminResetIpRateLimit.limit(ip),
  ]);
  if (!verifyLimit.success || !ipLimit.success) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Please try again later." },
      { status: 429 },
    );
  }

  // Reject weak passwords BEFORE consuming the OTP so a valid code isn't
  // burned on a client-side validation slip.
  const strength = validateNewPassword(newPassword);
  if (!strength.ok) {
    return NextResponse.json({ ok: false, error: strength.error }, { status: 400 });
  }

  const admin = await resolveActiveAdminByPhone(to);
  if (!admin) {
    // No active admin for this number. Generic invalid reply.
    void logLogisticsAudit({
      actionType: "BLOCKED",
      entityType: "admin_password_reset",
      category: "security",
      description: `Reset verify for non-admin number ${maskPhone(to)}`,
      metadata: { step: "verify", outcome: "no_match", ip },
    });
    return NextResponse.json({ ok: false, error: "Invalid or expired code." }, { status: 401 });
  }

  const result = await verifyOtp(resetOtpKey(to), code);
  if (!result.ok) {
    void logLogisticsAudit({
      actionType: "BLOCKED",
      entityType: "admin_password_reset",
      entityId: admin.id,
      category: "security",
      description: `Reset OTP verify failed (${result.reason}) for admin ${maskPhone(to)}`,
      metadata: { step: "verify", outcome: result.reason, ip },
    });
    if (result.reason === "too_many_attempts") {
      return NextResponse.json(
        { ok: false, error: "Too many attempts. Request a new code." },
        { status: 429 },
      );
    }
    return NextResponse.json({ ok: false, error: "Invalid or expired code." }, { status: 401 });
  }

  // OTP valid + single-use consumed. Set the new password on the auth user.
  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
    admin.id,
    { password: newPassword },
  );

  if (updateErr) {
    console.error("[admin/reset/verify] password update failed:", updateErr.message);
    void logLogisticsAudit({
      actionType: "BLOCKED",
      entityType: "admin_password_reset",
      entityId: admin.id,
      category: "security",
      description: `Reset password update FAILED for admin ${maskPhone(to)}`,
      metadata: { step: "verify", outcome: "update_error", ip },
    });
    return NextResponse.json(
      { ok: false, error: "Could not update password. Please try again." },
      { status: 500 },
    );
  }

  void logLogisticsAudit({
    actionType: "UPDATE",
    entityType: "admin_password_reset",
    entityId: admin.id,
    category: "security",
    description: `Super-admin password reset via SMS OTP (${maskPhone(to)})`,
    metadata: { step: "verify", outcome: "password_changed", ip },
  });

  return NextResponse.json({ ok: true });
}
