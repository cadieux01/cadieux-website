// GET   /api/mkt/profiles  → everyone in the marketing workspace (admin + non-admin).
// POST  /api/mkt/profiles  → admin invite flow: create a profile linked to
//                            an existing auth.users row by email, so the
//                            new teammate can sign in with their existing
//                            Supabase Auth password (or reset it).
//
// ADMIN ONLY. The route resolves the caller's profile via the Supabase
// Auth cookie, checks role='admin', and refuses otherwise. profiles RLS
// outside this migration's scope controls what the caller sees; this
// route additionally enforces the admin shape of the UI (listing +
// setting role/status) so an authed non-admin can't call this endpoint
// directly to reach the list.

import { NextRequest, NextResponse } from "next/server";
import { mktServerClient } from "@/lib/mkt-auth";

async function requireAdminServer(sb: ReturnType<typeof mktServerClient>) {
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const { data: me } = await sb
    .from("profiles")
    .select("role, status")
    .eq("id", userRes.user.id)
    .maybeSingle();
  if (!me || me.role !== "admin" || me.status !== "active") {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { user: userRes.user, me };
}

export async function GET() {
  const sb = mktServerClient();
  const gate = await requireAdminServer(sb);
  if ("error" in gate) return gate.error;

  const { data, error } = await sb
    .from("profiles")
    .select("id, full_name, email, phone, role, status, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ profiles: data ?? [] });
}
