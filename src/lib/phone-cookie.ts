import { createHmac } from "crypto";

const SECRET = process.env.OTP_SECRET ?? "cadieux_otp_fallback_secret";

export const PHONE_COOKIE_NAME = "cdx_phone_verified";
export const PHONE_COOKIE_TTL_MS = 30 * 60 * 1000; // 30 min

export function signPhoneCookie(phone: string, exp: number): string {
  const payload = `${phone}:${exp}`;
  const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
  return `${payload}:${sig}`;
}

export function verifyPhoneCookie(value: string | undefined): { phone: string; exp: number } | null {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length !== 3) return null;
  const [phone, expStr, sig] = parts;
  const exp = parseInt(expStr, 10);
  if (!phone || !exp) return null;
  if (Date.now() > exp) return null;
  const expected = createHmac("sha256", SECRET).update(`${phone}:${exp}`).digest("hex");
  if (sig !== expected) return null;
  return { phone, exp };
}

/** Normalises a phone number to +91… form. Mirror of normalizePhone in send-sms. */
export function normalizePhone(raw: string): string {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (String(raw).startsWith("+")) return String(raw);
  return `+${digits}`;
}
