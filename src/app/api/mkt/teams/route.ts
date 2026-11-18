// GET  /api/mkt/teams          → list of teams the caller can see (RLS).
// POST /api/mkt/teams          → create a team (admin only via RLS).
//
// Reads/writes happen under the caller's Supabase Auth session so the
// SELECT / INSERT policies on logistics.teams enforce visibility.

import { NextRequest, NextResponse } from "next/server";
import { mktServerClient } from "@/lib/mkt-auth";

export async function GET() {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: teams, error } = await sb
    .from("teams")
    .select("id, name, description, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const ids = (teams ?? []).map((t) => t.id);
  const { data: members } = ids.length
    ? await sb
        .from("team_members")
        .select("team_id, profile_id, is_leader, added_at")
        .in("team_id", ids)
    : { data: [] as Array<Record<string, unknown>> };
  return NextResponse.json({ teams: teams ?? [], members: members ?? [] });
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
  const { data, error } = await sb
    .from("teams")
    .insert({
      name,
      description:
        typeof body?.description === "string" ? body.description.trim() : null,
      created_by: userRes.user.id,
    })
    .select("id, name, description, created_at")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ team: data });
}
