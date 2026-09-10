// GET /api/admin/order-notifications/retry
//
// Manually re-send every order alert that never made it out. Same sweep the
// daily cron runs; this exists so Sunny can trigger it the moment he notices a
// missing email instead of waiting for 09:00 IST.
//
// Auth: the normal admin session (HttpOnly `admin_session` cookie OR
// `Authorization: Bearer <token>`). GET-with-cookie is deliberate — an admin
// already logged into /admin can just open this URL in the browser, so nobody
// has to handle a secret to run it.
//
// GET rather than POST despite mutating: the whole point is browser-address-bar
// triggering. It is safe to repeat — the attempt cap bounds it, and rows that
// already sent are excluded by the sweep's own filter.
//
// Response: the sweep result, including `cappedRows` — the alerts that have
// hit MAX_NOTIFICATION_ATTEMPTS and will never send without someone looking at
// them. Those are reported, never quietly dropped.

import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { sweepOrderNotifications } from "@/lib/order-notification";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sweepOrderNotifications();
  return NextResponse.json(result);
}
