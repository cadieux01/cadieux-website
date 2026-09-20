// PATCH /api/admin/subscriptions/[id]/deliveries/[deliveryId]
//
// The subscription-delivery row carries TWO parallel column pairs:
//   delivery_date   / slot                — the "planned" columns
//   scheduled_date  / scheduled_time_slot — the "admin-scheduled" columns
//
// Historically this route only wrote the scheduled_* columns. That kept
// the admin edit panel and the customer-facing tracking page (which reads
// scheduled_* ?? delivery_*) in agreement — the customer saw the new date
// via the coalesce. But the bake plan groups by `delivery_date` and only
// falls back to slot when scheduled_time_slot is null: after an admin
// move, the plan would still schedule the old date. That was the latent
// desync — plan and customer-visible schedule disagreed until the next
// deploy or manual fix.
//
// This route now writes ALL FOUR columns atomically for a scheduling
// edit, so the bake plan, admin views, and customer tracking never
// disagree again. Legacy rows on the old scheduled_* columns keep
// working because the coalesce in the admin derive still holds; new
// rows are simply consistent across both pairs.
//
// The route also refuses to move a delivery onto a date already held by
// a non-cancelled sibling delivery on the same subscription — silently
// double-booking a plan produces bake-plan duplicates that the operator
// discovers hours later.
//
// A customer-visible `order_notes` edit row is written whenever the
// schedule actually moves, using the shared wording helper so this
// reads the same as the orders-side admin_edit_order RPC output. Audit
// event is recorded on every mutation; unchanged saves fall through to
// the existing "Updated delivery <id>" audit line.

import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { formatSlotForDisplay, isValidSlotValue } from "@/lib/delivery-slots";
import { formatDeliveryEditNote } from "@/lib/order-notes";

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

  // Slot validation — new writes MUST land on one of the three canonical
  // windows. Legacy rows on bare "07:30" or "06:00-07:00" stay readable
  // because we don't rewrite them here, but the picker can only choose
  // canonical values.
  if (typeof body.scheduled_time_slot === "string" && body.scheduled_time_slot) {
    if (!isValidSlotValue(body.scheduled_time_slot)) {
      return NextResponse.json(
        { error: "Pick a delivery window (Morning / Midday / Evening)." },
        { status: 400 },
      );
    }
    update.scheduled_time_slot = body.scheduled_time_slot;
    // Mirror onto the planned column so the bake plan agrees.
    update.slot = body.scheduled_time_slot;
  }
  if (typeof body.scheduled_date === "string" && body.scheduled_date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.scheduled_date)) {
      return NextResponse.json({ error: "Invalid date." }, { status: 400 });
    }
    update.scheduled_date = body.scheduled_date;
    // Mirror onto the planned column so the bake plan agrees.
    update.delivery_date = body.scheduled_date;
  }
  if (typeof body.admin_notes === "string") {
    update.admin_notes = body.admin_notes;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // Optional optimistic-concurrency guard, same contract as the parent
  // subscription route: when the client sends the status it believes is
  // current we only write if the row STILL has it. Omitting
  // expected_status keeps the previous behaviour exactly.
  const expected =
    typeof body.expected_status === "string"
      ? body.expected_status.toLowerCase()
      : null;

  // Read the FULL before-state we need for audit + collision check +
  // note wording. Read delivery_date/slot too so the note reads from
  // the operator's mental model (the planned columns) rather than
  // whatever scheduled_* was last set to.
  const { data: before } = await supabaseAdmin
    .from("subscription_deliveries")
    .select("status, scheduled_date, scheduled_time_slot, delivery_date, slot, subscription_id")
    .eq("id", params.deliveryId)
    .eq("subscription_id", params.id)
    .maybeSingle();

  // Collision check — before we touch anything. Only fires when the
  // date is actually moving; a slot-only change on the same date is
  // fine. Any non-cancelled sibling delivery on the same date blocks
  // the move (a plan cannot legally have two shipments on one day).
  const finalDateForCollision =
    (update.scheduled_date ?? before?.scheduled_date ?? before?.delivery_date ?? null) as
      | string
      | null;
  const dateIsMoving =
    update.scheduled_date !== undefined &&
    (before?.scheduled_date ?? before?.delivery_date ?? null) !==
      (update.scheduled_date ?? null);
  if (dateIsMoving && finalDateForCollision) {
    const { data: siblings } = await supabaseAdmin
      .from("subscription_deliveries")
      .select("id, status")
      .eq("subscription_id", params.id)
      .neq("id", params.deliveryId)
      .or(
        `delivery_date.eq.${finalDateForCollision},scheduled_date.eq.${finalDateForCollision}`,
      );
    const conflict = (siblings ?? []).find(
      (r) => r.status !== "cancelled",
    );
    if (conflict) {
      return NextResponse.json(
        {
          error: `Another delivery on this plan is already on ${finalDateForCollision}. Cancel that one first, or pick a different date.`,
          code: "date_collision",
        },
        { status: 409 },
      );
    }
  }

  let updateQuery = supabaseAdmin
    .from("subscription_deliveries")
    .update(update)
    .eq("id", params.deliveryId)
    .eq("subscription_id", params.id);
  if (expected) {
    updateQuery = updateQuery.eq("status", expected);
  }
  const { data: updatedRows, error } = await updateQuery.select("id");

  if (error) {
    console.error("[admin/subscription_deliveries PATCH]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Conditional write matched no row → the status moved under us.
  if (expected && (!updatedRows || updatedRows.length === 0)) {
    return NextResponse.json(
      {
        error:
          "This was already changed elsewhere — reload to see the current state.",
        code: "stale",
        current_status: before?.status ?? null,
      },
      { status: 409 },
    );
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

  // Customer-visible edit-note on a schedule move. Written after the
  // update succeeds so a failed UPDATE does not leave a phantom "moved
  // to X" line on the customer's timeline. Read from the planned
  // columns (delivery_date/slot) as the "from" side — that is the
  // value the customer would have seen before this call.
  if (schedulingChanged) {
    const beforeDateForNote =
      (before?.scheduled_date ?? before?.delivery_date ?? null) as string | null;
    const beforeSlotForNote =
      (before?.scheduled_time_slot ?? before?.slot ?? null) as string | null;
    const afterDate =
      (update.scheduled_date ?? beforeDateForNote) as string | null;
    const afterSlot =
      (update.scheduled_time_slot ?? beforeSlotForNote) as string | null;
    // Author comes from the same header EditOrderPanel already sends;
    // route.ts is server-side and cannot prompt for it. Null is valid
    // (author column is nullable).
    const authorRaw = req.headers.get("x-admin-first-name");
    const author = authorRaw && authorRaw.trim().length > 0
      ? authorRaw.trim().slice(0, 60)
      : null;
    const noteBody = formatDeliveryEditNote(
      { date: beforeDateForNote, slot: beforeSlotForNote ? formatSlotForDisplay(beforeSlotForNote) : null },
      { date: afterDate, slot: afterSlot ? formatSlotForDisplay(afterSlot) : null },
    );
    const { error: noteErr } = await supabaseAdmin.from("order_notes").insert({
      subscription_id: params.id,
      kind: "edit",
      body: noteBody,
      author,
      customer_visible: true,
      meta: {
        delivery_id: params.deliveryId,
        scheduled_date_before: beforeDateForNote,
        scheduled_date_after: afterDate,
        scheduled_time_slot_before: beforeSlotForNote,
        scheduled_time_slot_after: afterSlot,
      },
    });
    if (noteErr) {
      // Non-fatal: the schedule move already landed. Log so an operator
      // can retro-add a note if the timeline lookes bare.
      console.error("[admin/subscription_deliveries PATCH note]", noteErr.message);
    }
  }

  // Auto-flip parent status when every delivery has reached a terminal state.
  //   at least one delivered → parent 'completed'
  //   every delivery cancelled → parent 'cancelled' (an all-cancelled plan
  //     was never fulfilled; calling it "completed" would be a false record)
  // Guard the update so we only overwrite still-open parent statuses —
  // 'active' AND 'pending_confirmation'. The old guard was 'active' only,
  // which trapped pending_confirmation parents (e.g. a single-week plan
  // marked delivered before payment ever moved the parent to active).
  const { data: rest } = await supabaseAdmin
    .from("subscription_deliveries")
    .select("status")
    .eq("subscription_id", params.id);
  if (rest && rest.length > 0) {
    const allTerminal = rest.every(
      (r) => r.status === "delivered" || r.status === "cancelled"
    );
    if (allTerminal) {
      const anyDelivered = rest.some((r) => r.status === "delivered");
      const nextStatus = anyDelivered ? "completed" : "cancelled";
      await supabaseAdmin
        .from("subscriptions")
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq("id", params.id)
        .in("status", ["active", "pending_confirmation"]);
    }
  }

  return NextResponse.json({ ok: true });
}
