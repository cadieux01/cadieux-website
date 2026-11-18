// GET  /api/mkt/campaigns?template=1|0  → campaigns visible to the caller
// POST /api/mkt/campaigns                → create a campaign (RLS-gated)
//
// All reads/writes run under the Supabase Auth cookie, so the
// SELECT/INSERT policies on logistics.campaigns (admin, owner, or
// team-leader for INSERT; plus team-member for SELECT; plus templates
// visible to all actives) enforce visibility.

import { NextRequest, NextResponse } from "next/server";
import { mktServerClient } from "@/lib/mkt-auth";

const STATUSES = new Set(["planned", "active", "paused", "done", "cancelled"]);

export async function GET(req: NextRequest) {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const template = req.nextUrl.searchParams.get("template");

  let q = sb
    .from("campaigns")
    .select(
      "id, name, objective, status, starts_on, ends_on, budget_paise, props_cost_paise, headcount_needed, detail, owner_id, team_id, is_template, cloned_from_id, created_by, created_at, updated_at",
    )
    .order("starts_on", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (template === "1") q = q.eq("is_template", true);
  else if (template === "0") q = q.eq("is_template", false);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ campaigns: data ?? [], me: userRes.user.id });
}

export async function POST(req: NextRequest) {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const status =
    typeof body?.status === "string" && STATUSES.has(body.status)
      ? body.status
      : "planned";

  const insert = {
    name,
    objective: typeof body?.objective === "string" ? body.objective : null,
    status,
    starts_on: typeof body?.starts_on === "string" ? body.starts_on : null,
    ends_on: typeof body?.ends_on === "string" ? body.ends_on : null,
    budget_paise:
      typeof body?.budget_paise === "number" ? Math.max(0, Math.round(body.budget_paise)) : 0,
    props_cost_paise:
      typeof body?.props_cost_paise === "number"
        ? Math.max(0, Math.round(body.props_cost_paise))
        : 0,
    headcount_needed:
      typeof body?.headcount_needed === "number"
        ? Math.max(0, Math.round(body.headcount_needed))
        : 0,
    detail: typeof body?.detail === "string" ? body.detail : null,
    // owner defaults to the caller; the INSERT policy refuses someone
    // else's owner_id unless the caller is admin.
    owner_id:
      typeof body?.owner_id === "string" ? body.owner_id : userRes.user.id,
    team_id: typeof body?.team_id === "string" ? body.team_id : null,
    is_template: Boolean(body?.is_template),
    created_by: userRes.user.id,
  };

  const { data, error } = await sb
    .from("campaigns")
    .insert(insert)
    .select(
      "id, name, objective, status, starts_on, ends_on, budget_paise, props_cost_paise, headcount_needed, detail, owner_id, team_id, is_template, cloned_from_id, created_by, created_at, updated_at",
    )
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ campaign: data });
}
