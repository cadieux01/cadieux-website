// GET  /api/mkt/goals  → goals visible to the caller (RLS).
// POST /api/mkt/goals  → create a goal.

import { NextRequest, NextResponse } from "next/server";
import { mktServerClient } from "@/lib/mkt-auth";

const HORIZONS = new Set(["short", "long"]);

export async function GET() {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await sb
    .from("goals")
    .select(
      "id, title, detail, horizon, target_date, owner_id, team_id, created_by, created_at, updated_at",
    )
    .order("target_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ goals: data ?? [] });
}

export async function POST(req: NextRequest) {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const horizon = typeof body?.horizon === "string" ? body.horizon : "short";
  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (!HORIZONS.has(horizon)) {
    return NextResponse.json({ error: "horizon must be short|long" }, { status: 400 });
  }
  const { data, error } = await sb
    .from("goals")
    .insert({
      title,
      detail: typeof body?.detail === "string" ? body.detail : null,
      horizon,
      target_date: typeof body?.target_date === "string" ? body.target_date : null,
      owner_id:
        typeof body?.owner_id === "string" ? body.owner_id : userRes.user.id,
      team_id: typeof body?.team_id === "string" ? body.team_id : null,
      created_by: userRes.user.id,
    })
    .select(
      "id, title, detail, horizon, target_date, owner_id, team_id, created_by, created_at, updated_at",
    )
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ goal: data });
}
