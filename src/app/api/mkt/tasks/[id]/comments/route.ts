// GET  /api/mkt/tasks/[id]/comments  → comments on this task, newest last
// POST /api/mkt/tasks/[id]/comments  → add a comment (RLS gates it)
//
// Visibility and write access are RLS-gated through the tasks table:
// if you can SELECT the task, you can SELECT and INSERT comments. The
// comments table has NO update policy — a comment is append-only.

import { NextRequest, NextResponse } from "next/server";
import { mktServerClient } from "@/lib/mkt-auth";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Newest LAST — chat convention. The brief said "newest last".
  const { data, error } = await sb
    .from("task_comments")
    .select("id, task_id, author_id, body, created_at")
    .eq("task_id", params.id)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Hydrate author display names in one round-trip.
  const authorIds = Array.from(
    new Set((data ?? []).map((r) => r.author_id).filter(Boolean)),
  ) as string[];
  const authors = new Map<string, { full_name: string | null; email: string | null }>();
  if (authorIds.length > 0) {
    const { data: profiles } = await sb
      .from("profiles")
      .select("id, full_name, email")
      .in("id", authorIds);
    for (const p of profiles ?? []) {
      authors.set(p.id as string, {
        full_name: (p.full_name as string | null) ?? null,
        email: (p.email as string | null) ?? null,
      });
    }
  }

  const comments = (data ?? []).map((r) => ({
    ...r,
    author:
      r.author_id && authors.has(r.author_id as string)
        ? authors.get(r.author_id as string)
        : null,
  }));
  return NextResponse.json({ comments, me: userRes.user.id });
}

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
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Body is required" }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json(
      { error: "Body must be 4000 characters or fewer" },
      { status: 400 },
    );
  }
  const { data, error } = await sb
    .from("task_comments")
    .insert({ task_id: params.id, author_id: userRes.user.id, body: text })
    .select("id, task_id, author_id, body, created_at")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ comment: data });
}
