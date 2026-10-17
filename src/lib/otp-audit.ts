// Audit trail for the OTP endpoints — both the send pair
// (/api/verify/send, /api/mobile/verify/send) and the check pair
// (/api/verify/check, /api/mobile/verify/check). They used to write
// NOTHING, which is why "who asked for this OTP?" could only ever be
// answered by reading source instead of querying data.
//
// One row per ATTEMPT — not just per delivered SMS or successful login.
// The blocked outcomes are the interesting ones: they separate "we sent an
// SMS" from "something is hammering the endpoint".
//
// Query it with:
//   select created_at, description, metadata
//     from logistics.audit_logs
//    where entity_type in ('otp_send', 'otp_check')
//    order by created_at desc;
//
// SEND AND CHECK ARE SEPARATE `entity_type`s ON PURPOSE. Keeping check rows
// out of 'otp_send' means the existing send metrics ("how many did we
// send", "how many were rate limited") stay countable with the same query
// they have always used, instead of silently acquiring a second population
// of rows with a disjoint set of outcomes.
//
// WHY THE CHECK SIDE EXISTS AT ALL — the 2026-10-16/17 OTP incident. Sends
// were logged 'sent' throughout (MSG91 accepted every call) and yet almost
// nothing converted, which left two causes indistinguishable after the
// fact: the SMS never reached the handset, or the stored HMAC stopped
// matching (a changed OTP_SECRET / swapped Upstash dataset — see
// otp-store.ts). The discriminator is whether customers were SUBMITTING
// codes and being rejected, or never submitting at all. Nothing recorded
// that. These rows do.
//
// PRIVACY RULE: a full phone number must NEVER reach audit_logs. Every
// number goes through maskPhone() in writeOtpRow(), and callers pass the
// raw number to logOtpSend() / logOtpCheck() rather than formatting it
// themselves, so there is exactly one place this can be got wrong.

import type { NextRequest } from "next/server";
import { maskPhone } from "@/lib/phone-cookie";
import { logLogisticsAudit, type LogisticsAction } from "@/lib/logistics-audit";
import type { VerifyResult } from "@/lib/otp-store";

/** How a send attempt ended. */
export type OtpSendOutcome =
  | "sent"
  | "rate_limited"
  | "turnstile_failed"
  | "send_failed";

/**
 * How a check attempt ended: `ok`, plus every failure reason verifyOtp can
 * return.
 *
 * DERIVED from otp-store.ts's VerifyResult rather than hand-listed, so the
 * two cannot drift. Add a reason there and this union widens with it, which
 * turns "a new outcome nobody logs" into a compile error at the call sites.
 * Today that resolves to expired | invalid | too_many_attempts.
 */
export type OtpCheckOutcome =
  | "ok"
  | Extract<VerifyResult, { ok: false }>["reason"];

export type OtpOutcome = OtpSendOutcome | OtpCheckOutcome;

export type OtpChannel = "web" | "mobile";

export type OtpAuditMeta = {
  ip: string;
  channel: OtpChannel;
  source: string;
  referer: string | null;
  ua: string;
};

/** Which surface triggered the send, derived from the Referer path. */
function sourceFromReferer(referer: string | null, channel: OtpChannel): string {
  if (channel === "mobile") return "mobile-app";
  if (!referer) return "unknown";
  try {
    const { pathname } = new URL(referer);
    if (pathname.startsWith("/subscriptions/setup/checkout")) {
      return "subscription-checkout";
    }
    if (pathname.startsWith("/checkout")) return "checkout";
    return pathname;
  } catch {
    return "unknown";
  }
}

/**
 * Request-derived context, built once per request and spread into each
 * exit's log call. The Referer is stored WITHOUT its query string — the
 * path is all we need for attribution and a query string is somewhere
 * personal data could hide.
 */
export function otpAuditMeta(
  req: NextRequest,
  ip: string,
  channel: OtpChannel,
): OtpAuditMeta {
  const referer = req.headers.get("referer");
  let refererPath: string | null = null;
  if (referer) {
    try {
      const u = new URL(referer);
      refererPath = `${u.origin}${u.pathname}`;
    } catch {
      refererPath = null;
    }
  }
  return {
    ip,
    channel,
    source: sourceFromReferer(referer, channel),
    referer: refererPath,
    ua: (req.headers.get("user-agent") ?? "").slice(0, 200),
  };
}

/**
 * Fire-and-forget audit write shared by both sides. Deliberately NOT
 * awaited (the `void`) so the OTP path takes no added latency; the
 * underlying helper already swallows its own errors.
 *
 * NOTHING HERE MAY THROW. These calls sit on the login path, so an audit
 * problem must never become a failed verification. `maskPhone` and the
 * object spread cannot throw, and logLogisticsAudit catches internally.
 */
function writeOtpRow(
  entityType: "otp_send" | "otp_check",
  action: LogisticsAction,
  rawPhone: string,
  verb: string,
  meta: OtpAuditMeta & { outcome: OtpOutcome },
): void {
  const masked = maskPhone(rawPhone);
  void logLogisticsAudit({
    actionType: action,
    entityType,
    category: "security",
    description: `${verb} ${meta.outcome} for ${masked} via ${meta.source}`,
    // Not an admin action — don't inherit the helper's "Super Admin" default.
    userName: meta.channel === "mobile" ? "Mobile app (public)" : "Website (public)",
    metadata: { ...meta, phone: masked },
  });
}

/**
 * One row per send attempt.
 *
 * `requestId` is MSG91's own id for the accepted message. It is the only
 * handle that ties one of these rows to a line in MSG91's delivery log, and
 * so the only way to answer "we logged 'sent' — did it actually arrive?"
 * without matching on phone + timestamp by eye. Null whenever MSG91's
 * response did not carry one; see extractRequestId in msg91.ts.
 */
export function logOtpSend(
  action: LogisticsAction,
  rawPhone: string,
  meta: OtpAuditMeta & {
    outcome: OtpSendOutcome;
    error?: string;
    requestId?: string | null;
  },
): void {
  writeOtpRow("otp_send", action, rawPhone, "OTP", meta);
}

/**
 * One row per check attempt — the funnel's second half.
 *
 * `LOGIN` on success (this endpoint is what signs a customer in) and
 * `BLOCKED` on every rejection. Both values are already permitted by
 * logistics.audit_logs' action_type CHECK constraint, so this needs no
 * migration — verified against the live constraint, which accepts exactly
 * CREATE / UPDATE / DELETE / LOGIN / FEEDBACK_REPLY / BLOCKED / LOCKOUT. Do
 * not invent an action_type here: the writer swallows its own errors, so a
 * constraint violation would silently log nothing at all, which is the
 * exact blindness these rows exist to remove.
 */
export function logOtpCheck(
  rawPhone: string,
  meta: OtpAuditMeta & { outcome: OtpCheckOutcome },
): void {
  writeOtpRow(
    "otp_check",
    meta.outcome === "ok" ? "LOGIN" : "BLOCKED",
    rawPhone,
    "OTP check",
    meta,
  );
}
