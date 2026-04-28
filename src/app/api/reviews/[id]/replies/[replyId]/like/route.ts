import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; replyId: string } }
) {
  const { data: row, error: readErr } = await supabaseAdmin
    .from("review_replies")
    .select("likes_count")
    .eq("id", params.replyId)
    .eq("review_id", params.id)
    .single();
  if (readErr || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const next = (row.likes_count ?? 0) + 1;
  const { error } = await supabaseAdmin
    .from("review_replies")
    .update({ likes_count: next })
    .eq("id", params.replyId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ likes_count: next });
}
