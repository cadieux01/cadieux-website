// The 503 both OTP send routes return when Upstash is unreachable.
//
// Fail CLOSED, uniquely on this route. Not the usual fail-open: the OTP
// STORE is the same Upstash instance (otp-store.ts), so putOtp would throw
// four lines down and verifyOtp could never redeem the code. Sending here
// would spend an SMS and DLT reputation on an OTP guaranteed not to work.
//
// "this route" is now both of them — /api/verify/send and
// /api/mobile/verify/send share this helper and the same `ratelimit:otp`
// budget. Two failure points per route go through it: the rate-limit call
// and putOtp itself. They are one failure from the customer's point of
// view, so they get one answer.
//
// DO NOT "fix" this to allowedOrFailOpen. That helper's fail-open is
// ratified for src/middleware.ts, where a throw 500s EVERY API route
// including checkout, so letting abuse through for the length of an outage
// is the cheaper loss. Here the trade is inverted: the route cannot do its
// job without Redis, so failing open buys nothing and costs money.
//
// Before this existed both routes let the exception escape as an unhandled
// 500. The mobile one matters more, not less — the Android app has no OTA,
// so a 500 there cannot be hotfixed, while `error` below is rendered
// verbatim by apiFetch with no Play release.

import { NextResponse } from "next/server";

import { ADMIN_PHONE } from "@/lib/delivery-slots";
import { logOtpSend, type OtpAuditMeta } from "@/lib/otp-audit";

/** Seconds a client should wait before retrying. Kept in step with "a few
 *  minutes" in the copy — if you change one, change the other. */
const RETRY_AFTER_SECONDS = 180;

/** Finished customer copy, not an error code: the app prints it as-is. Names
 *  a way through rather than dead-ending someone mid-checkout, same reasoning
 *  as ORDER_PHONE_LIMIT_MESSAGE. */
export const OTP_UNAVAILABLE_MESSAGE =
  `We can't send verification codes right now. Please try again in a few ` +
  `minutes, or call us on ${ADMIN_PHONE} and we'll take your order directly.`;

/** `reason` is an internal tag for the audit row and the server log — it is
 *  never shown to the customer. */
export function otpUnavailable(
  to: string,
  meta: OtpAuditMeta,
  reason: "limiter_unavailable" | "store_unavailable",
  err: unknown,
): NextResponse {
  console.error(`⚠️  OTP ${reason}, refusing send:`, err);
  logOtpSend("BLOCKED", to, { ...meta, outcome: "send_failed", error: reason });
  return NextResponse.json(
    { ok: false, error: OTP_UNAVAILABLE_MESSAGE },
    {
      status: 503,
      headers: { "Retry-After": String(RETRY_AFTER_SECONDS) },
    },
  );
}
