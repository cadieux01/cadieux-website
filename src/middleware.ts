import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { apiRateLimit, getClientIP } from "@/lib/ratelimit";

export async function middleware(request: NextRequest) {
  // Only rate limit API routes
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Authenticated admin clients bypass the IP-based limiter. Admin polls
  // /api/admin/* every 10s across multiple endpoints; the 30/min cap
  // would otherwise starve the dashboard.
  const adminToken = request.headers.get("x-admin-token");
  if (adminToken && adminToken === process.env.ADMIN_TOKEN) {
    return NextResponse.next();
  }

  const ip = getClientIP(request);
  const { success } = await apiRateLimit.limit(ip);

  if (!success) {
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
