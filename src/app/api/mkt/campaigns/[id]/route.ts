// GET    /api/mkt/campaigns/[id]  → single campaign
// PATCH  /api/mkt/campaigns/[id]  → update fields (RLS-gated)
// DELETE /api/mkt/campaigns/[id]  → admin only

import { NextRequest, NextResponse } from "next/server";
import { mktServerClient } from "@/lib/mkt-auth";

const STATUSES = new Set(["planned", "active", "paused", "done", "cancelled"]);

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await sb
    .from("campaigns")
    .select(
      "id, name, objective, status, starts_on, ends_on, budget_paise, props_cost_paise, headcount_needed, detail, owner_id, team_id, is_template, cloned_from_id, created_by, created_at, updated_at",
    )
    .eq("id", params.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ campaign: data, me: userRes.user.id });
}

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

  if (typeof body.name === "string") update.name = body.name.trim();
  if ("objective" in body) update.objective = typeof body.objective === "string" ? body.objective : null;
  if (typeof body.status === "string") {
    if (!STATUSES.has(body.status)) {
      return NextResponse.json({ error: "Bad status" }, { status: 400 });
    }
    update.status = body.status;
  }
  if ("starts_on" in body) update.starts_on = typeof body.starts_on === "string" ? body.starts_on : null;
  if ("ends_on" in body) update.ends_on = typeof body.ends_on === "string" ? body.ends_on : null;
  if (typeof body.budget_paise === "number") update.budget_paise = Math.max(0, Math.round(body.budget_paise));
  if (typeof body.props_cost_paise === "number") update.props_cost_paise = Math.max(0, Math.round(body.props_cost_paise));
  if (typeof body.headcount_needed === "number") update.headcount_needed = Math.max(0, Math.round(body.headcount_needed));
  if ("detail" in body) update.detail = typeof body.detail === "string" ? body.detail : null;
  if ("team_id" in body) update.team_id = typeof body.team_id === "string" ? body.team_id : null;
  if ("owner_id" in body) update.owner_id = typeof body.owner_id === "string" ? body.owner_id : null;
  if ("is_template" in body) update.is_template = Boolean(body.is_template);

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await sb.from("campaigns").update(update).eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { error } = await sb.from("campaigns").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
