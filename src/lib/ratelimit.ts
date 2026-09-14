import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { ADMIN_PHONE } from "@/lib/delivery-slots";

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

/** Orders allowed per phone per window. The 429 copy no longer quotes this
 *  number — see ORDER_PHONE_LIMIT_MESSAGE for why — so it is now only the
 *  limiter's own setting, shared with the subscription-path copy below. */
export const ORDER_PHONE_LIMIT = 3;

// Orders: 3 per phone per 30 minutes, as a second axis on order creation.
//
// IP alone is not enough (a script can rotate egress) and phone alone is not
// enough (a script can rotate numbers), so both are checked and either can
// reject.
//
// Why 3/30m: measured against real traffic, exactly one genuine customer has
// ever exceeded it (4 COD orders in 30 minutes on 10 Sep) versus a probe that
// created thirty-plus. One blocked order in two weeks is the accepted trade.
//
// DEPLOY ORDER MATTERS. 3/30m is only safe once checkout stops minting a new
// order on every payment retry. Before that fix, a customer whose card failed
// re-entered /api/create-order on each attempt and spent a unit of this budget
// per try, so three failed attempts locked out a real buyer. The evidence above
// counts ORDERS CREATED, which cannot see failed payment retries — so it does
// not measure this. The dependency is `fix(checkout): reuse pending order on
// same-tab Pay retries` (70acb02), which shipped ahead of this cap. If you ever
// revert that, revert this too; never run this cap without it.
//
// Residual cost even with that fix: reuse is in-session only, so a hard reload
// between attempts still creates a fresh order and spends a unit. That is
// survivable ONLY because the 429 is recoverable — it names the limit and hands
// the customer a phone number rather than dead-ending them. If you tighten this
// further, or drop that copy, read ORDER_PHONE_LIMIT_MESSAGE first.
export const orderPhoneRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(ORDER_PHONE_LIMIT, "30 m"),
  analytics: true,
  prefix: "ratelimit:order:phone",
});

/**
 * 429 copy for the per-phone order cap.
 *
 * A real customer who hits this is someone ordering for several people, so the
 * message must offer a way through. The number comes from ADMIN_PHONE, never a
 * literal — the mobile app already carries its own hardcoded copy, and two
 * sources of truth for a phone number is how they drift.
 *
 * Deliberately states NO count. Upstash's sliding window is approximate: it
 * carries the previous window in weighted by elapsed time, so a burst that
 * straddles a window boundary is refused on the Nth attempt rather than the
 * (N+1)th. Verified in prod 2026-09-14 — the 5/hour IP limiter denied the 5th
 * request. Copy that asserted "you've placed 3 orders" would therefore tell a
 * customer who placed 2 that they placed 3, and they would know it was wrong
 * exactly when we need them to trust the phone number in the next sentence.
 */
export const ORDER_PHONE_LIMIT_MESSAGE =
  `You've reached the order limit for the last half hour. ` +
  `For a larger order, call us on ${ADMIN_PHONE} and we'll take it directly.`;

/** Same cap, reached on the subscription-creation path. Worded for what that
 *  key actually counts (attempts, not placed orders) — it uses a separate
 *  `sub:` budget. */
export const SUBSCRIPTION_PHONE_LIMIT_MESSAGE =
  `You've made ${ORDER_PHONE_LIMIT} subscription attempts in the last half ` +
  `hour. To set up a larger plan, call us on ${ADMIN_PHONE} and we'll take it ` +
  `directly.`;

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

// Admin WhatsApp sends — a compromised admin session should not be
// able to blast messages to customers via our Business API number.
// 30 sends per admin per minute is comfortably above the pace a human
// support agent replies at (roughly 1 msg every 2s) and well below
// what a script would attempt. Keyed by IP.
export const adminWhatsappSendRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1 m"),
  analytics: true,
  prefix: "ratelimit:admin:wa-send",
});

/**
 * `limit()` that never throws.
 *
 * Upstash is a network dependency. On the create paths a thrown error would
 * become a 500 and take checkout down for everyone, which is a far worse
 * outcome than letting abuse through for the duration of the outage — so an
 * unreachable limiter fails OPEN and logs.
 */
export async function allowedOrFailOpen(
  limiter: Ratelimit,
  key: string
): Promise<boolean> {
  try {
    const { success } = await limiter.limit(key);
    return success;
  } catch (err) {
    console.error("⚠️  rate-limit check failed, allowing request:", key, err);
    return true;
  }
}

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
