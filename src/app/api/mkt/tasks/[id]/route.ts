// PATCH /api/mkt/tasks/[id] — update a task. RLS decides who's allowed
// to update what (admin / assignee / author / team leader).

import { NextRequest, NextResponse } from "next/server";
import { mktServerClient } from "@/lib/mkt-auth";

const CADENCES = new Set(["one-off", "daily", "weekly", "monthly"]);
const STATUSES = new Set(["todo", "in_progress", "done", "blocked"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};

  if (typeof body?.title === "string") update.title = body.title.trim();
  if ("detail" in body) {
    update.detail = typeof body.detail === "string" ? body.detail : null;
  }
  if ("assignee_id" in body) {
    update.assignee_id =
      typeof body.assignee_id === "string" ? body.assignee_id : null;
  }
  if ("team_id" in body) {
    update.team_id = typeof body.team_id === "string" ? body.team_id : null;
  }
  if ("goal_id" in body) {
    update.goal_id = typeof body.goal_id === "string" ? body.goal_id : null;
  }
  if ("due_date" in body) {
    update.due_date =
      typeof body.due_date === "string" ? body.due_date : null;
  }
  if (typeof body?.cadence === "string") {
    if (!CADENCES.has(body.cadence)) {
      return NextResponse.json({ error: "Bad cadence" }, { status: 400 });
    }
    update.cadence = body.cadence;
  }
  if (typeof body?.status === "string") {
    if (!STATUSES.has(body.status)) {
      return NextResponse.json({ error: "Bad status" }, { status: 400 });
    }
    update.status = body.status;
  }
  if (typeof body?.progress === "number") {
    update.progress = Math.max(0, Math.min(100, Math.round(body.progress)));
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await sb.from("tasks").update(update).eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
