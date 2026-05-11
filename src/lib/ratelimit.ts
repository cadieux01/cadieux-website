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
