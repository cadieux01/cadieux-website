// GET  /api/mkt/notifications       → unread + recent read, for auth.uid()
// PATCH /api/mkt/notifications     → mark a list of ids as read
//
// Reads logistics.notifications via the Supabase Auth cookie, so RLS
// (notifications_select_own, notifications_mark_read — see the
// 20261118165900 migration) decides what the caller sees. There is no
// bearer here; the admin HMAC cookie is irrelevant on this lane.

import { NextRequest, NextResponse } from "next/server";
import { mktServerClient } from "@/lib/mkt-auth";

export async function GET() {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 50 newest — the inbox button only ever shows a small feed.
  const { data, error } = await sb
    .from("notifications")
    .select("id, type, title, message, related_id, is_read, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const unread = (data ?? []).filter((n) => !n.is_read).length;
  return NextResponse.json({ notifications: data ?? [], unread });
}

export async function PATCH(req: NextRequest) {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { ids?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is string => typeof x === "string")
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, updated: 0 });
  }

  const { error, count } = await sb
    .from("notifications")
    .update({ is_read: true }, { count: "exact" })
    .in("id", ids);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, updated: count ?? 0 });
}
