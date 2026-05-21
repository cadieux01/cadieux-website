import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { formatSlotForDisplay } from "@/lib/delivery-slots";

const ALLOWED_STATUSES = new Set([
  "pending_confirmation",
  "confirmed",
  "out_for_delivery",
  "delivered",
  "cancelled",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; deliveryId: string } }
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};

  if (typeof body.status === "string") {
    const s = body.status.toLowerCase();
    if (!ALLOWED_STATUSES.has(s)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    update.status = s;
    update.status_updated_at = new Date().toISOString();
  }
  if (typeof body.scheduled_date === "string" && body.scheduled_date) {
    update.scheduled_date = body.scheduled_date;
  }
  if (typeof body.scheduled_time_slot === "string" && body.scheduled_time_slot) {
    update.scheduled_time_slot = body.scheduled_time_slot;
  }
  if (typeof body.admin_notes === "string") {
    update.admin_notes = body.admin_notes;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data: before } = await supabaseAdmin
    .from("subscription_deliveries")
    .select("status, scheduled_date, scheduled_time_slot")
    .eq("id", params.deliveryId)
    .eq("subscription_id", params.id)
    .maybeSingle();

  const { error } = await supabaseAdmin
    .from("subscription_deliveries")
    .update(update)
    .eq("id", params.deliveryId)
    .eq("subscription_id", params.id);

  if (error) {
    console.error("[admin/subscription_deliveries PATCH]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const statusChanged =
    typeof update.status === "string" && before?.status !== update.status;
  const dateChanged =
    update.scheduled_date !== undefined &&
    (before?.scheduled_date ?? null) !== (update.scheduled_date ?? null);
  const slotChanged =
    update.scheduled_time_slot !== undefined &&
    (before?.scheduled_time_slot ?? null) !== (update.scheduled_time_slot ?? null);
  const schedulingChanged = dateChanged || slotChanged;

  // Admin override: scheduling edits bypass both the 12 h 10 m booking
  // rule and the 14 h self-edit rule. We log the new date+slot so the
  // audit page surfaces it clearly.
  let context: string;
  if (schedulingChanged) {
    const finalDate =
      (update.scheduled_date ?? before?.scheduled_date ?? null) as string | null;
    const finalSlot =
      (update.scheduled_time_slot ?? before?.scheduled_time_slot ?? null) as string | null;
    const slotLabel = finalSlot ? formatSlotForDisplay(finalSlot) : "—";
    context = `Admin changed delivery to ${finalDate ?? "—"} ${slotLabel}`;
  } else if (statusChanged) {
    context = `Delivery status: ${before?.status ?? "—"} → ${update.status as string}`;
  } else {
    context = `Updated delivery ${params.deliveryId.slice(0, 8)}`;
  }

  void recordAuditEvent({
    req,
    entity: "subscription_delivery",
    action: statusChanged ? "status_change" : "update",
    targetId: params.deliveryId,
    targetLabel: `Delivery ${params.deliveryId.slice(0, 8)}`,
    context,
    meta: {
      subscription_id: params.id,
      fields: Object.keys(update).filter((k) => k !== "status_updated_at"),
      ...(statusChanged
        ? { status_before: before?.status ?? null, status_after: update.status }
        : {}),
      ...(dateChanged
        ? {
            scheduled_date_before: before?.scheduled_date ?? null,
            scheduled_date_after: update.scheduled_date ?? null,
          }
        : {}),
      ...(slotChanged
        ? {
            scheduled_time_slot_before: before?.scheduled_time_slot ?? null,
            scheduled_time_slot_after: update.scheduled_time_slot ?? null,
          }
        : {}),
    },
  });

  // If all deliveries for this subscription are now delivered/cancelled, mark
  // the subscription as completed automatically.
  const { data: rest } = await supabaseAdmin
    .from("subscription_deliveries")
    .select("status")
    .eq("subscription_id", params.id);
  if (rest && rest.length > 0) {
    const allDone = rest.every(
      (r) => r.status === "delivered" || r.status === "cancelled"
    );
    if (allDone) {
      await supabaseAdmin
        .from("subscriptions")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", params.id)
        .eq("status", "active");
    }
  }

  return NextResponse.json({ ok: true });
}
