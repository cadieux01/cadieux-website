import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/lib/audit-log";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; replyId: string } }
) {
  if (req.headers.get("x-admin-token") !== process.env.ADMIN_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { error } = await supabaseAdmin
    .from("review_replies")
    .delete()
    .eq("id", params.replyId)
    .eq("review_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  void recordAuditEvent({
    req,
    entity: "review",
    action: "delete",
    targetId: params.replyId,
    targetLabel: params.replyId,
    context: "Admin deleted reply",
    meta: { review_id: params.id, reply_id: params.replyId },
  });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; replyId: string } }
) {
  if (req.headers.get("x-admin-token") !== process.env.ADMIN_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let payload: any;
  try { payload = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const body = typeof payload?.body === "string" ? payload.body.trim() : "";
  if (!body || body.length > 1000) {
    return NextResponse.json({ error: "Body must be 1–1000 chars" }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin
    .from("review_replies")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", params.replyId)
    .eq("review_id", params.id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  void recordAuditEvent({
    req,
    entity: "review",
    action: "update",
    targetId: params.replyId,
    targetLabel: params.replyId,
    context: "Admin edited reply",
    meta: { review_id: params.id, reply_id: params.replyId },
  });
  return NextResponse.json({ reply: data });
}
