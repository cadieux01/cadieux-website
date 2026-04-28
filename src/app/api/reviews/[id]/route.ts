import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function isAdmin(req: NextRequest) {
  return req.headers.get("x-admin-token") === process.env.ADMIN_TOKEN;
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { error } = await supabaseAdmin.from("reviews").delete().eq("id", params.id);
  if (error) {
    console.error("review delete failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let payload: any;
  try { payload = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const body = typeof payload?.body === "string" ? payload.body.trim() : "";
  if (!body || body.length > 1000) {
    return NextResponse.json({ error: "Body must be 1–1000 chars" }, { status: 400 });
  }
  const update: Record<string, any> = { body, edited_at: new Date().toISOString() };
  if (payload.rating !== undefined) {
    const r = payload.rating;
    if (r === null) update.rating = null;
    else if (typeof r === "number" && r >= 1 && r <= 5) update.rating = Math.round(r);
    else return NextResponse.json({ error: "Rating must be 1–5 or null" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin
    .from("reviews")
    .update(update)
    .eq("id", params.id)
    .select("*")
    .single();
  if (error) {
    console.error("review patch failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ review: data });
}
