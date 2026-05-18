import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "").toLowerCase(); // "approve" | "reject"
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  const adminResponse =
    typeof body.admin_response === "string" ? body.admin_response : null;

  const { data: cr } = await supabaseAdmin
    .from("subscription_change_requests")
    .select("id, delivery_id, requested_date, requested_time_slot, status")
    .eq("id", params.id)
    .maybeSingle();
  if (!cr) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (cr.status !== "pending") {
    return NextResponse.json(
      { error: "Already resolved" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  if (action === "approve") {
    const update: Record<string, unknown> = {};
    if (cr.requested_date) update.scheduled_date = cr.requested_date;
    if (cr.requested_time_slot)
      update.scheduled_time_slot = cr.requested_time_slot;
    if (Object.keys(update).length > 0) {
      const { error: dErr } = await supabaseAdmin
        .from("subscription_deliveries")
        .update(update)
        .eq("id", cr.delivery_id);
      if (dErr) {
        return NextResponse.json({ error: dErr.message }, { status: 500 });
      }
    }
  }

  const { error } = await supabaseAdmin
    .from("subscription_change_requests")
    .update({
      status: action === "approve" ? "approved" : "rejected",
      admin_response: adminResponse,
      updated_at: now,
    })
    .eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  void recordAuditEvent({
    req,
    entity: "change_request",
    action: "update",
    targetId: params.id,
    targetLabel: `Request ${params.id.slice(0, 8)}`,
    context: `Change request ${action}d`,
    meta: {
      action,
      delivery_id: cr.delivery_id,
      requested_date: cr.requested_date,
      requested_time_slot: cr.requested_time_slot,
      admin_response: adminResponse,
    },
  });

  return NextResponse.json({ ok: true });
}
