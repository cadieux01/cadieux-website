import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// OTP requests: 3 per phone per hour
export const otpRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "1 h"),
  analytics: true,
  prefix: "ratelimit:otp",
});

// Orders: 5 per IP per hour
export const orderRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "1 h"),
  analytics: true,
  prefix: "ratelimit:order",
});

// Reviews: 3 per IP per day
export const reviewRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "1 d"),
  analytics: true,
  prefix: "ratelimit:review",
});

// Reviews from mobile: 3 per OTP-verified phone per day. Keyed on the
// 10-digit local phone (not IP) — mobile carriers NAT thousands of users
// behind a single egress address, so IP is too coarse for this surface.
export const mobileReviewRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "1 d"),
  analytics: true,
  prefix: "ratelimit:reviews:mobile",
});

// General API: 30 requests per IP per minute (DDoS protection)
export const apiRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1 m"),
  analytics: true,
  prefix: "ratelimit:api",
});

// Self-serve subscription delivery edits: 10 per customer per day. Keyed by
// the OTP-verified phone so admins / multiple customers behind the same NAT
// don't share a quota.
export const editRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 d"),
  analytics: true,
  prefix: "ratelimit:edit",
});

// Mobile profile edits (name/email/photo/marketing): 10 per phone per day.
// Keyed by 10-digit local phone, same reasoning as other mobile limits.
export const profileEditRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 d"),
  analytics: true,
  prefix: "ratelimit:profile-edit:mobile",
});

// Address book creates: 10 per phone per day.
export const addressCreateRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 d"),
  analytics: true,
  prefix: "ratelimit:address-create:mobile",
});

// Transactional SMS/WhatsApp triggers — keyed two ways so abuse is
// caught from either the phone-spam vector (one target, many calls) or
// the IP-spam vector (one bot, many targets).
//   Phone bucket: 3 sends per recipient per hour.
//   IP bucket:    10 sends per source IP per hour.
export const smsPhoneRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "1 h"),
  analytics: true,
  prefix: "ratelimit:sms:phone",
});
export const smsIpRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 h"),
  analytics: true,
  prefix: "ratelimit:sms:ip",
});

// Super-admin password reset (Forgot password → SMS OTP). Hard-limited
// from BOTH vectors so neither a single-target phone flood nor a single-IP
// bot can abuse the recovery path:
//   Phone bucket: 3 reset-OTP requests per phone per hour.
//   IP bucket:    3 reset-OTP requests per source IP per hour.
export const adminResetPhoneRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "1 h"),
  analytics: true,
  prefix: "ratelimit:admin-reset:phone",
});
export const adminResetIpRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "1 h"),
  analytics: true,
  prefix: "ratelimit:admin-reset:ip",
});
// Reset verify attempts — a coarse second gate on top of the OTP store's
// own 5-wrong-guess burn. 10 verify calls per phone per hour.
export const adminResetVerifyRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 h"),
  analytics: true,
  prefix: "ratelimit:admin-reset:verify",
});

// Admin review replies — bounded so a compromised admin session can't
// spam reply rows across the catalogue. Keyed by the admin session
// signature (falls back to IP).
export const adminReplyRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
  analytics: true,
  prefix: "ratelimit:admin:reply",
});

// Helper to get IP from request
export function getClientIP(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const realIP = req.headers.get("x-real-ip");

  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  if (realIP) {
    return realIP;
  }
  return "unknown";
}
