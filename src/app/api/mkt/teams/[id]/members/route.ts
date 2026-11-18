// POST   /api/mkt/teams/[id]/members           → add a member
//                                                 { profile_id, is_leader? }
// PATCH  /api/mkt/teams/[id]/members           → flip is_leader
//                                                 { profile_id, is_leader }
// DELETE /api/mkt/teams/[id]/members?profile_id=…  → remove a member
//
// All three routes run under the caller's session so RLS on
// logistics.team_members decides who's allowed to change what: admin
// OR the team's leader(s).

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
  const profile_id = typeof body?.profile_id === "string" ? body.profile_id : null;
  if (!profile_id) {
    return NextResponse.json({ error: "profile_id is required" }, { status: 400 });
  }
  const is_leader = Boolean(body?.is_leader);
  const { error } = await sb
    .from("team_members")
    .insert({ team_id: params.id, profile_id, is_leader });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
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
  const profile_id = typeof body?.profile_id === "string" ? body.profile_id : null;
  if (!profile_id || typeof body?.is_leader !== "boolean") {
    return NextResponse.json(
      { error: "profile_id + is_leader are required" },
      { status: 400 },
    );
  }
  const { error } = await sb
    .from("team_members")
    .update({ is_leader: body.is_leader })
    .eq("team_id", params.id)
    .eq("profile_id", profile_id);
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
  const profile_id = req.nextUrl.searchParams.get("profile_id");
  if (!profile_id) {
    return NextResponse.json({ error: "profile_id is required" }, { status: 400 });
  }
  const { error } = await sb
    .from("team_members")
    .delete()
    .eq("team_id", params.id)
    .eq("profile_id", profile_id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
