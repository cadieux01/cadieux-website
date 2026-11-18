// GET  /api/mkt/tasks  → tasks visible to the caller (RLS: admin, assignee,
//                        author, or team member).
// POST /api/mkt/tasks  → create a task. `created_by` is forced to the
//                        signed-in user; the RLS insert policy also
//                        gates on team leadership when `team_id` is set.
//
// Also hands back a bundled list of assignable profiles (active rows,
// via a second query under the caller's session) so the UI only has to
// hit one endpoint for the usual render path.

import { NextRequest, NextResponse } from "next/server";
import { mktServerClient } from "@/lib/mkt-auth";

const CADENCES = new Set(["one-off", "daily", "weekly", "monthly"]);
const STATUSES = new Set(["todo", "in_progress", "done", "blocked"]);

export async function GET() {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [tasksRes, goalsRes] = await Promise.all([
    sb
      .from("tasks")
      .select(
        "id, title, detail, assignee_id, created_by, team_id, goal_id, due_date, cadence, status, progress, created_at, updated_at",
      )
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false }),
    sb
      .from("goals")
      .select(
        "id, title, detail, horizon, target_date, owner_id, team_id, created_by, created_at, updated_at",
      )
      .order("target_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false }),
  ]);

  if (tasksRes.error) {
    return NextResponse.json({ error: tasksRes.error.message }, { status: 500 });
  }
  if (goalsRes.error) {
    return NextResponse.json({ error: goalsRes.error.message }, { status: 500 });
  }
  return NextResponse.json({
    me: userRes.user.id,
    tasks: tasksRes.data ?? [],
    goals: goalsRes.data ?? [],
  });
}

export async function POST(req: NextRequest) {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const cadence =
    typeof body?.cadence === "string" && CADENCES.has(body.cadence)
      ? body.cadence
      : "one-off";
  const status =
    typeof body?.status === "string" && STATUSES.has(body.status)
      ? body.status
      : "todo";
  const progress =
    typeof body?.progress === "number" ? Math.max(0, Math.min(100, body.progress)) : 0;

  const insert = {
    title,
    detail: typeof body?.detail === "string" ? body.detail : null,
    assignee_id:
      typeof body?.assignee_id === "string" ? body.assignee_id : null,
    created_by: userRes.user.id,
    team_id: typeof body?.team_id === "string" ? body.team_id : null,
    goal_id: typeof body?.goal_id === "string" ? body.goal_id : null,
    due_date: typeof body?.due_date === "string" ? body.due_date : null,
    cadence,
    status,
    progress,
  };

  const { data, error } = await sb
    .from("tasks")
    .insert(insert)
    .select(
      "id, title, detail, assignee_id, created_by, team_id, goal_id, due_date, cadence, status, progress, created_at, updated_at",
    )
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ task: data });
}
