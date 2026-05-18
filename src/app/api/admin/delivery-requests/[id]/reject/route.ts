// Admin: dismiss a delivery_request without activating the pincode.
// Use when the location is outside our delivery capacity for the
// foreseeable future. No customer-facing notification is sent — the
// admin is expected to reach out directly via WhatsApp/call.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { note?: unknown };
  const note =
    typeof body.note === "string" && body.note.trim()
      ? body.note.trim().slice(0, 500)
      : null;

  const { data: requestRow, error: loadErr } = await supabaseAdmin
    .from("delivery_requests")
    .select("id, pincode")
    .eq("id", params.id)
    .maybeSingle();
  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!requestRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error: updateErr } = await supabaseAdmin
    .from("delivery_requests")
    .update({
      status: "rejected",
      resolved_at: new Date().toISOString(),
      resolved_by: "admin",
      resolution_note: note,
    })
    .eq("id", params.id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  void recordAuditEvent({
    req,
    entity: "other",
    action: "status_change",
    targetId: params.id,
    targetLabel: `Delivery request ${requestRow.pincode}`,
    context: `Rejected delivery request for pincode ${requestRow.pincode}`,
    meta: { pincode: requestRow.pincode, note },
  });

  return NextResponse.json({ ok: true });
}
