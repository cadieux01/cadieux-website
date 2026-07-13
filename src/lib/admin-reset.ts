// Super-admin password reset — shared helpers for the two-step SMS-OTP
// recovery flow (/api/admin/reset/start + /api/admin/reset/verify).
//
// Scope guard: ONLY an ACTIVE `admin` row in logistics.profiles can use
// this path. Sales/partner/customer numbers never resolve here, so the
// recovery route can't be turned into a password reset for anyone else.
// The auth user id == logistics.profiles.id (1:1), so once we resolve the
// admin row we can updateUserById() against it with the service role.

import { supabaseAdmin } from "@/lib/admin-auth";

// Namespaced OTP-store key so an admin reset can never collide with (or
// overwrite) a CUSTOMER OTP for the same phone. The customer flow keys on
// the bare "+91…" string; we prefix ours.
export function resetOtpKey(phoneE164: string): string {
  return `admin-reset:${phoneE164}`;
}

/** Last 10 digits of any phone form, for tolerant comparison. */
function last10(raw: string | null | undefined): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
}

export type ActiveAdmin = { id: string };

// Resolve the ACTIVE super-admin whose registered phone matches. We compare
// the last 10 digits against BOTH profiles.phone and profiles.phone_number
// (the dashboard writes one or the other depending on onboarding path).
// Returns null when no active admin matches — callers MUST still respond
// generically so a caller can't probe which numbers are admins.
export async function resolveActiveAdminByPhone(
  phoneE164: string,
): Promise<ActiveAdmin | null> {
  const target = last10(phoneE164);
  if (target.length !== 10) return null;

  const { data, error } = await supabaseAdmin
    .schema("logistics")
    .from("profiles")
    .select("id, phone, phone_number")
    .eq("role", "admin")
    .eq("status", "active");

  if (error || !data) return null;

  const match = data.find(
    (r) => last10(r.phone) === target || last10(r.phone_number) === target,
  );
  return match ? { id: match.id } : null;
}

export type PasswordCheck = { ok: true } | { ok: false; error: string };

// Minimum strength for a NEW admin password: at least 10 characters with
// both a letter and a number. Deliberately stricter than the customer-side
// (which has no password at all) because this credential fronts the whole
// super-admin dashboard.
export function validateNewPassword(pw: string): PasswordCheck {
  if (typeof pw !== "string" || pw.length < 10) {
    return { ok: false, error: "Password must be at least 10 characters." };
  }
  if (pw.length > 200) {
    return { ok: false, error: "Password is too long." };
  }
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    return {
      ok: false,
      error: "Password must include at least one letter and one number.",
    };
  }
  return { ok: true };
}
