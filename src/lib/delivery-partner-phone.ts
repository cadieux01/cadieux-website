// Shared helpers for the admin `delivery_partners` table.
//
// The DB stores whatever string the operator typed (so the Edit modal
// round-trips exactly what they see), but we always send a strict
// digits-only country-coded form to wa.me. Kept as a pure module so
// both the API validator and the Share button use identical rules.

/**
 * Normalize an admin-typed phone into the digits wa.me expects.
 *
 * - Strips everything that isn't a digit.
 * - If it looks like a 10-digit Indian mobile (starts 6-9), prefixes 91.
 * - If it's already 11-15 digits, assumes it includes a country code.
 * - Anything shorter than 10 digits, or 10 digits not starting 6-9,
 *   is rejected (returns null) — wa.me would silently fail on those.
 */
export function normalizeWhatsAppPhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

/** Best-effort pretty form for display in the admin table. */
export function formatPartnerPhoneDisplay(stored: string): string {
  const normalized = normalizeWhatsAppPhone(stored);
  if (!normalized) return stored;
  if (normalized.startsWith("91") && normalized.length === 12) {
    return `+91 ${normalized.slice(2, 7)} ${normalized.slice(7)}`;
  }
  return `+${normalized}`;
}
