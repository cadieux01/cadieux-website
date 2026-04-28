import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  // Read-modify-write. Fine here: counts are a vanity metric, not money.
  const { data: row, error: readErr } = await supabaseAdmin
    .from("reviews")
    .select("likes_count")
    .eq("id", params.id)
    .single();
  if (readErr || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const next = (row.likes_count ?? 0) + 1;
  const { error } = await supabaseAdmin
    .from("reviews")
    .update({ likes_count: next })
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ likes_count: next });
}
