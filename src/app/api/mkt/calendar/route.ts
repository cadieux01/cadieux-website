// GET /api/mkt/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Returns the caller's visible tasks (by due_date in [from, to]) and
// visible campaigns (whose [starts_on, ends_on] overlaps [from, to]).
//
// Tolerant to missing tables: logistics.campaigns is added by a
// separate branch's migration, so this route uses Promise.allSettled
// and treats any individual-slice failure as an empty slice — a
// calendar with tasks only is still useful; a 500 that hides tasks
// because campaigns isn't there yet is not.

import { NextRequest, NextResponse } from "next/server";
import { mktServerClient } from "@/lib/mkt-auth";

function isoDate(v: string | null): string | null {
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export async function GET(req: NextRequest) {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const from = isoDate(req.nextUrl.searchParams.get("from"));
  const to = isoDate(req.nextUrl.searchParams.get("to"));
  if (!from || !to) {
    return NextResponse.json(
      { error: "from and to (YYYY-MM-DD) are required" },
      { status: 400 },
    );
  }

  // Tasks on their due_date. We keep every status so the calendar
  // can colour overdue done-tasks differently if it wants; filtering
  // 'done' out would hide completed deliveries from a historical
  // week view.
  const tasksQ = sb
    .from("tasks")
    .select("id, title, assignee_id, team_id, due_date, status, progress, cadence")
    .gte("due_date", from)
    .lte("due_date", to)
    .order("due_date", { ascending: true });

  // Campaigns: any campaign whose window overlaps [from, to]. A
  // campaign with NULL starts_on or ends_on is deliberately dropped
  // — no window, no block on the calendar.
  const campaignsQ = sb
    .from("campaigns")
    .select("id, name, status, starts_on, ends_on, team_id")
    .not("starts_on", "is", null)
    .not("ends_on", "is", null)
    .lte("starts_on", to)
    .gte("ends_on", from)
    .order("starts_on", { ascending: true });

  const [tasksRes, campaignsRes] = await Promise.allSettled([tasksQ, campaignsQ]);

  const tasks =
    tasksRes.status === "fulfilled" && !tasksRes.value.error
      ? tasksRes.value.data ?? []
      : [];
  const tasks_error =
    tasksRes.status === "rejected"
      ? String(tasksRes.reason)
      : tasksRes.value.error?.message ?? null;

  const campaigns =
    campaignsRes.status === "fulfilled" && !campaignsRes.value.error
      ? campaignsRes.value.data ?? []
      : [];
  // A missing campaigns table (branch not merged yet) comes through
  // as a PostgREST 404 on the table — surface the message so the UI
  // can show "campaigns unavailable" rather than hiding the slice.
  const campaigns_error =
    campaignsRes.status === "rejected"
      ? String(campaignsRes.reason)
      : campaignsRes.value.error?.message ?? null;

  return NextResponse.json({
    from,
    to,
    tasks,
    tasks_error,
    campaigns,
    campaigns_error,
    me: userRes.user.id,
  });
}
