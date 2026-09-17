// GET /api/admin/bake-plan?date=YYYY-MM-DD
//
// The subscription half of a day's bake, for the production strip above
// /admin/orders.
//
// WHY THIS EXISTS
// The strip sums the orders the operator is looking at. Subscription stops
// come out of the same oven and were not counted anywhere on screen — only
// in the 18:00 email. A baker reading the strip at five in the morning was
// therefore reading an UNDER-count, which is the expensive direction: the
// loaf that was never made cannot be handed over at the door.
//
// ONLY THE SUBSCRIPTION LEG. The orders leg stays client-side, recomputed
// from the exact array the table is rendering, because that is what makes
// the strip's order numbers unable to disagree with what is being scrolled.
// This endpoint supplies the half the browser has no way to know.
//
// The query is `loadSubscriptionLines` from @/lib/bake-plan-lines — the SAME
// function the cron calls. A second query here would be a second definition
// of "due on day D", and the screen and the email would drift apart on the
// first change to either.

import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { loadSubscriptionLines } from "@/lib/bake-plan-lines";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A single day is required, not defaulted. A bake is a day's question,
  // and silently answering for "today" when the board is showing another
  // date is exactly the kind of quiet disagreement this whole endpoint
  // exists to remove.
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!DATE_RE.test(date)) {
    return NextResponse.json(
      { error: "date=YYYY-MM-DD required" },
      { status: 400 },
    );
  }

  try {
    const lines = await loadSubscriptionLines(supabaseAdmin, date);
    return NextResponse.json({
      date,
      // Trimmed to what the strip counts. Name and phone are deliberately
      // left out — the strip states quantities, not people.
      deliveries: lines.map((l) => ({
        ref: l.ref,
        items: l.items,
        paid: l.paid,
        address: l.address,
        pincode: l.pincode,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[admin/bake-plan]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
