import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdmin } from "@/lib/admin-auth";
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
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // SOFT delete only (project rule). Restore via PATCH { is_deleted: false }.
  // The public GET filters is_deleted=true so this hides the reply on web +
  // app immediately.
  const { error } = await supabaseAdmin
    .from("review_replies")
    .update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.replyId)
    .eq("review_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  void recordAuditEvent({
    req,
    entity: "review",
    action: "delete",
    targetId: params.replyId,
    targetLabel: params.replyId,
    context: "Admin soft-deleted reply",
    meta: { review_id: params.id, reply_id: params.replyId },
  });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; replyId: string } }
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let payload: { body?: unknown; is_deleted?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  let edited = false;

  if (payload.is_deleted !== undefined) {
    if (typeof payload.is_deleted !== "boolean") {
      return NextResponse.json(
        { error: "is_deleted must be a boolean" },
        { status: 400 }
      );
    }
    update.is_deleted = payload.is_deleted;
    update.deleted_at = payload.is_deleted ? new Date().toISOString() : null;
  }
  if (payload.body !== undefined) {
    const body = typeof payload.body === "string" ? payload.body.trim() : "";
    if (!body || body.length > 1000) {
      return NextResponse.json(
        { error: "Body must be 1–1000 chars" },
        { status: 400 }
      );
    }
    update.body = body;
    update.is_edited = true;
    update.edited_at = new Date().toISOString();
    edited = true;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  update.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("review_replies")
    .update(update)
    .eq("id", params.replyId)
    .eq("review_id", params.id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const toggledDelete = payload.is_deleted !== undefined;
  void recordAuditEvent({
    req,
    entity: "review",
    action: toggledDelete && !edited ? "delete" : "update",
    targetId: params.replyId,
    targetLabel: params.replyId,
    context:
      toggledDelete && !edited
        ? payload.is_deleted
          ? "Admin soft-deleted reply"
          : "Admin restored reply"
        : "Admin edited reply",
    meta: { review_id: params.id, reply_id: params.replyId },
  });
  return NextResponse.json({ reply: data });
}
