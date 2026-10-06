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

/** Orders allowed per phone per window. No 429 copy quotes this number any
 *  more — see ORDER_PHONE_LIMIT_MESSAGE for why — so it is now purely the
 *  limiter's own setting. */
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

/** Same cap, reached on the subscription-creation path — it uses a separate
 *  `sub:` budget. States no count, for the same reason as
 *  ORDER_PHONE_LIMIT_MESSAGE: the sliding window is approximate, so the number
 *  can be wrong at the exact moment it is used to refuse someone. */
export const SUBSCRIPTION_PHONE_LIMIT_MESSAGE =
  `You've reached the subscription limit for the last half hour. To set up ` +
  `more, call us on ${ADMIN_PHONE} and we'll do it directly.`;

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

/**
 * The same 30/min ceiling, on a SEPARATE budget, for the handful of endpoints
 * a customer cannot complete a purchase without: /api/verify/*,
 * /api/create-order and /api/verify-payment. See CHECKOUT_CRITICAL_PATHS in
 * src/middleware.ts for the routing.
 *
 * Why this exists: one shared 30/min bucket meant ordinary page chatter
 * (pre-order mode, product floors, serviceability, delivery quote — some of it
 * fired twice per load before the client dedupe) spent the budget that the pay
 * step then needed, and a failed card that the customer retries spends more of
 * it per attempt. I tripped a real 429 on live prod with modest probing. The
 * customer sees "Rate limit exceeded. Please slow down." with money not yet
 * taken, which is the worst moment on the site to hand someone a dead end.
 *
 * This does NOT raise any ceiling — it stops browsing traffic and paying
 * traffic from competing for the same one, and 30/min is still far above human
 * pace on four endpoints. Nothing is opened up, because every path on the list
 * keeps its own much tighter domain limiter underneath: orders are 5/IP/hour
 * plus 3/phone/30min, OTP send is 3/phone/hour, and OTP check burns the code
 * after MAX_ATTEMPTS guesses per phone (otp-store.ts) — a per-phone counter
 * that a wider IP allowance cannot touch. verify-payment is signature-gated.
 */
export const checkoutRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1 m"),
  analytics: true,
  prefix: "ratelimit:api:checkout",
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
 * How long we are willing to wait for a verdict from Upstash.
 *
 * WHY A BUDGET AT ALL: catching the throw is not enough. The Upstash SDK
 * retries internally before it gives up, and that retry budget was measured
 * here at ~4.3s (`ERR_INVALID_URL` on a missing URL, "fetch failed" on an
 * unreachable host). Worse, the limiter runs TWICE on every /api request —
 * once in middleware.ts, which matches `/api/:path*`, and again in the route
 * handler — so the stalls are additive: a route whose own handler logged
 * 4.32s answered the client in 8.62s. Fail-open without a deadline turns an
 * Upstash outage into an 8.6s wait for a correct answer instead of an 8.6s
 * wait for a 500. Better, but not acceptable.
 *
 * WHY 1500ms: it has to be far enough above a healthy round trip that it
 * never fires in normal operation, and small enough that 2x it is not itself
 * a broken-looking page. A same-region Upstash REST call is tens of ms, so
 * 1500ms is one to two orders of magnitude of headroom. I do NOT have a
 * production p99 for this limiter to quote — there are no Upstash credentials
 * in this checkout — so treat the number as a margin, not a measurement, and
 * revisit it if real p99 data ever says otherwise.
 *   - Lower (say 500ms) risks a false timeout on a cold container's first
 *     TLS handshake to Upstash. That fails OPEN, i.e. it would silently
 *     disable rate limiting on the first request of every new container —
 *     exactly the request shape that dominates while scaling up. That is the
 *     failure I least want to buy.
 *   - Higher (say 3s) is still inside the SDK's own ~4.3s retry budget, but
 *     2x3s = 6s at the client, which is not a meaningful improvement.
 * 2 x 1500ms = 3.0s worst case, against the 8.6s measured today.
 */
export const RATE_LIMIT_BUDGET_MS = 1500;

/**
 * `limit()` that never throws AND never blocks longer than the budget.
 *
 * Upstash is a network dependency. On the create paths a thrown error would
 * become a 500 and take checkout down for everyone, which is a far worse
 * outcome than letting abuse through for the duration of the outage — so an
 * unreachable OR slow limiter fails OPEN and logs.
 *
 * WHAT A LATE VERDICT DOES TO THE REQUEST: nothing. `Promise.race` subscribes
 * to both promises, so when the limiter settles after the deadline has
 * already won, the value is discarded — and a late *rejection* is still
 * observed by race's own handler, so it cannot surface as an
 * unhandledRejection and kill the function. The response has long since been
 * sent.
 *
 * The one real side effect is in Redis, not here: the sliding-window counter
 * still increments whenever the call eventually lands. A request we admitted
 * on a timeout is therefore admitted AND counted.
 *
 * DO NOT "FIX" THAT. It is the accepted trade: admitted-and-counted keeps the
 * window honest, and the cost is that after a slow spell a window can already
 * be spent, so some genuine traffic meets a 429 it did not earn. The
 * alternative — not counting a timed-out request — hands an attacker a free
 * request for every call it can make slow, which is the wrong way round.
 * Cancelling the in-flight `limit()` is not available either: the counter is
 * incremented server-side in Redis, so by the time we give up waiting the
 * token is already spent.
 */
export async function allowedOrFailOpen(
  limiter: Ratelimit,
  key: string,
  budgetMs: number = RATE_LIMIT_BUDGET_MS
): Promise<boolean> {
  // Sentinel rather than `undefined`/`false`, so a real verdict of `false`
  // (legitimately rate limited) can never be mistaken for a timeout.
  const TIMED_OUT = Symbol("rate-limit-timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const verdict = await Promise.race([
      limiter.limit(key).then(({ success }) => success),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), budgetMs);
      }),
    ]);

    if (verdict === TIMED_OUT) {
      console.error(
        `⚠️  rate-limit check exceeded ${budgetMs}ms, allowing request:`,
        key
      );
      return true;
    }
    return verdict;
  } catch (err) {
    console.error("⚠️  rate-limit check failed, allowing request:", key, err);
    return true;
  } finally {
    // Required, not tidiness: a live timer keeps the event loop busy and can
    // delay a serverless container's freeze for the rest of the budget on
    // every single request.
    clearTimeout(timer);
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
