// Public GET for app_config.preorder_mode.
//
// The value is NOT sensitive — the customer needs it to render the banner,
// disable the date/slot pickers, and label the subscribe CTA. Serving it via
// a route (rather than reading Supabase from the browser) keeps admin creds
// server-side and lets us add rate limits / caching later if needed.
//
// No caching. Brief is explicit: a stale toggle is worse than an extra
// network call. The client hook fetches on mount + on window focus.

import { NextResponse } from "next/server";
import { getPreorderMode } from "@/lib/preorderMode";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const enabled = await getPreorderMode();
  return NextResponse.json(
    { enabled },
    { headers: { "cache-control": "no-store" } },
  );
}
