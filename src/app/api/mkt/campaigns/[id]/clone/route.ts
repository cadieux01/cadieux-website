// POST /api/mkt/campaigns/[id]/clone
//
// "Run again" — reads the source campaign (which must be visible to
// the caller via RLS), copies most fields into a new row with new
// starts_on/ends_on + is_template=false + cloned_from_id pointing at
// the source. Assets are NOT copied (Phase 1 — flagged in the
// report).

import { NextRequest, NextResponse } from "next/server";
import { mktServerClient } from "@/lib/mkt-auth";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const starts_on = typeof body?.starts_on === "string" ? body.starts_on : null;
  const ends_on = typeof body?.ends_on === "string" ? body.ends_on : null;
  const nameOverride = typeof body?.name === "string" ? body.name.trim() : "";

  const { data: src, error: readErr } = await sb
    .from("campaigns")
    .select(
      "name, objective, budget_paise, props_cost_paise, headcount_needed, detail, owner_id, team_id, is_template",
    )
    .eq("id", params.id)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!src) {
    return NextResponse.json({ error: "Source campaign not found or not visible" }, { status: 404 });
  }

  const insert = {
    name: nameOverride || src.name,
    objective: src.objective,
    status: "planned",
    starts_on,
    ends_on,
    budget_paise: src.budget_paise,
    props_cost_paise: src.props_cost_paise,
    headcount_needed: src.headcount_needed,
    detail: src.detail,
    // Owner defaults to the caller — the clone is theirs to run, not
    // the original owner's.
    owner_id: userRes.user.id,
    team_id: src.team_id,
    is_template: false,
    cloned_from_id: params.id,
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
