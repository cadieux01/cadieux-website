// Audit trail for the OTP send endpoints (/api/verify/send and
// /api/mobile/verify/send). Both routes used to write NOTHING, which is
// why "who asked for this OTP?" could only ever be answered by reading
// source instead of querying data.
//
// One row per send ATTEMPT — not just per delivered SMS. The blocked
// outcomes are the interesting ones: they separate "we sent an SMS" from
// "something is hammering the endpoint".
//
// Query it with:
//   select created_at, description, metadata
//     from logistics.audit_logs
//    where entity_type = 'otp_send'
//    order by created_at desc;
//
// PRIVACY RULE: a full phone number must NEVER reach audit_logs. Every
// number goes through maskPhone() here, and callers pass the raw number
// to logOtpSend() rather than formatting it themselves so there is
// exactly one place this can be got wrong.

import type { NextRequest } from "next/server";
import { maskPhone } from "@/lib/phone-cookie";
import { logLogisticsAudit, type LogisticsAction } from "@/lib/logistics-audit";

export type OtpOutcome =
  | "sent"
  | "rate_limited"
  | "turnstile_failed"
  | "send_failed";

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
 * Fire-and-forget audit write. Deliberately NOT awaited by callers (they
 * pass it to `void`) so the OTP path takes no added latency; the
 * underlying helper already swallows its own errors.
 */
export function logOtpSend(
  action: LogisticsAction,
  rawPhone: string,
  meta: OtpAuditMeta & { outcome: OtpOutcome; error?: string },
): void {
  const masked = maskPhone(rawPhone);
  void logLogisticsAudit({
    actionType: action,
    entityType: "otp_send",
    category: "security",
    description: `OTP ${meta.outcome} for ${masked} via ${meta.source}`,
    // Not an admin action — don't inherit the helper's "Super Admin" default.
    userName: meta.channel === "mobile" ? "Mobile app (public)" : "Website (public)",
    metadata: { ...meta, phone: masked },
  });
}
