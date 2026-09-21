import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  allowedOrFailOpen,
  apiRateLimit,
  checkoutRateLimit,
  getClientIP,
} from "@/lib/ratelimit";

/** Endpoints a customer cannot complete a purchase without. These get their
 *  own IP budget instead of competing with page chatter for the general one —
 *  see checkoutRateLimit for the full reasoning. Keep this list SHORT: every
 *  addition is traffic the general limiter stops seeing. */
function isCheckoutCritical(pathname: string): boolean {
  return (
    pathname.startsWith("/api/verify/") || // OTP send + check
    pathname === "/api/create-order" ||
    pathname === "/api/verify-payment"
  );
}

export async function middleware(request: NextRequest) {
  // Only rate limit API routes
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Admin endpoints are gated by verifyAdminSession() inside each route
  // (HMAC-signed session cookie / Bearer, keyed on ADMIN_TOKEN). The
  // dashboard polls /api/admin/* every 10s across multiple endpoints
  // and a single click can fan out further requests; the public 30/min
  // cap would starve admin work. Skip the IP limiter on this prefix
  // entirely. Specific limiters (otp/order/review) still apply on the
  // user-facing endpoints they wrap.
  if (request.nextUrl.pathname.startsWith("/api/admin/")) {
    return NextResponse.next();
  }

  const ip = getClientIP(request);

  // Fails OPEN on an Upstash outage, deliberately.
  //
  // This limiter sits on `/api/:path*`, so it runs in front of every
  // non-admin API route — checkout and create-order included. A bare
  // `.limit()` throws when Upstash is unreachable, and a throw in middleware
  // 500s the request before any handler runs: one limiter outage became a
  // total API outage, checkout included. Briefly losing IP rate limiting is
  // strictly less harmful than that.
  //
  // The per-order limiters already followed this rule; the edge limiter in
  // front of them was missed. Do not unwrap this.
  const limiter = isCheckoutCritical(request.nextUrl.pathname)
    ? checkoutRateLimit
    : apiRateLimit;
  const underLimit = await allowedOrFailOpen(limiter, ip);

  if (!underLimit) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please slow down." },
      { status: 429 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
