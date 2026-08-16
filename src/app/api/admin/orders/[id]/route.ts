import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { notifyCustomer } from "@/lib/push";
import { isIsoDate, isValidSlotValue, formatSlotForDisplay } from "@/lib/delivery-slots";
import { canAutoRefund } from "@/lib/order-cancellation";
import { issueRazorpayRefund } from "@/lib/razorpay-refund";
import { computeOrderState } from "@/lib/order-state";

// New canonical stages + legacy values that pre-date the
// order-status-stages migration. The migration normalises existing
// rows on the way through, but we keep the legacy strings accepted
// here so any older admin tooling can still PATCH cleanly.
const ALLOWED_STATUSES = new Set([
  "placed",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "delivered",
  "cancelled",
  // pickup-only stages (see PICKUP_STAGES in lib/order-stages) — admin
  // clients only offer these on pickup orders, but we accept them here
  // regardless so a mis-clicked transition returns 200 not 400.
  "ready_for_pickup",
  "picked_up",
  // legacy aliases — accepted on input, normalised on write below
  "pending",
  "dispatched",
]);

const STATUS_ALIAS: Record<string, string> = {
  pending: "placed",
  dispatched: "out_for_delivery",
};

// Customer-facing copy for the push-triggering status transitions.
// Kept here (not in lib/push) because the wording is admin-flow specific.
const STATUS_PUSH_COPY: Record<string, { title: string; body: string }> = {
  confirmed: {
    title: "Order confirmed",
    body: "Your bread is being prepared.",
  },
  preparing: {
    title: "Preparing your order",
    body: "We're baking your bread now.",
  },
  out_for_delivery: {
    title: "On the way",
    body: "Your order is on the way!",
  },
  delivered: {
    title: "Delivered",
    body: "Your bread has been delivered. Enjoy!",
  },
  cancelled: {
    title: "Order cancelled",
    body: "Your order has been cancelled.",
  },
  ready_for_pickup: {
    title: "Ready for pickup",
    body: "Your loaf is staged at the stall — come pick it up.",
  },
  picked_up: {
    title: "Picked up",
    body: "Thanks for picking up your order. Enjoy!",
  },
};

// Admin-gated single-order GET. Mirrors the SELECT + pickup side-fetch +
// computed_state enrichment of /api/admin/orders (list) so consumers (the
// per-order print page) get the exact same row shape as an entry in the
// list response. Kept intentionally minimal — no writes, no side-effects.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, order_number, customer_id, total_amount, delivery_fee, status, payment_method, payment_status, delivery_address, delivery_date, delivery_slot, items, created_at, latitude, longitude, fulfillment_type, pickup_location_id, pickup_ready_at, picked_up_at, customers(id, full_name, phone, city)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[admin/orders GET]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Manual join for pickup_locations — same reason as the list route:
  // no FK exists between orders.pickup_location_id and pickup_locations.id.
  let pickup_location = null as
    | { id: string; name: string; area: string | null; address: string | null }
    | null;
  if (data.pickup_location_id) {
    const { data: loc } = await supabaseAdmin
      .from("pickup_locations")
      .select("id, name, area, address")
      .eq("id", data.pickup_location_id)
      .maybeSingle();
    pickup_location = loc ?? null;
  }

  const order = {
    ...data,
    pickup_location,
    computed_state: computeOrderState(data, Date.now()),
  };

  return NextResponse.json({ order });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};

  if (typeof body.status === "string") {
    const raw = body.status.toLowerCase();
    if (!ALLOWED_STATUSES.has(raw)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const s = STATUS_ALIAS[raw] ?? raw;
    update.status = s;
    // Stamp the moment the status changed so the customer Track Order
    // page can show "Updated <relative>" beneath the stage tracker.
    update.status_updated_at = new Date().toISOString();
    // Pickup-specific milestone stamps. Columns are nullable + idempotent-
    // safe (we only write on the forward transition).
    if (s === "ready_for_pickup") {
      update.pickup_ready_at = update.status_updated_at;
    } else if (s === "picked_up") {
      update.picked_up_at = update.status_updated_at;
    }
  }

  if (typeof body.delivery_address === "string") {
    const addr = body.delivery_address.trim();
    if (!addr) {
      return NextResponse.json({ error: "Empty delivery_address" }, { status: 400 });
    }
    update.delivery_address = addr;
  }

  // Admin override: delivery_date + delivery_slot can be edited freely
  // with NO time restriction (this is the manual path for phone-call
  // change requests). The 12 h 10 m booking and 14 h self-edit rules
  // do NOT apply here — admin is the human override.
  if (body.delivery_date !== undefined) {
    if (body.delivery_date === null || body.delivery_date === "") {
      update.delivery_date = null;
    } else if (typeof body.delivery_date === "string" && isIsoDate(body.delivery_date)) {
      update.delivery_date = body.delivery_date;
    } else {
      return NextResponse.json({ error: "Invalid delivery_date" }, { status: 400 });
    }
  }
  if (body.delivery_slot !== undefined) {
    if (body.delivery_slot === null || body.delivery_slot === "") {
      update.delivery_slot = null;
    } else if (typeof body.delivery_slot === "string" && isValidSlotValue(body.delivery_slot)) {
      update.delivery_slot = body.delivery_slot;
    } else {
      return NextResponse.json({ error: "Invalid delivery_slot" }, { status: 400 });
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Capture the prior status + scheduling so we can record a clean
  // before/after on the audit row when any of them change.
  const { data: before } = await supabaseAdmin
    .from("orders")
    .select("status, delivery_date, delivery_slot")
    .eq("id", params.id)
    .maybeSingle();

  const { data: updated, error } = await supabaseAdmin
    .from("orders")
    .update(update)
    .eq("id", params.id)
    .select(
      "id, customer_id, status, payment_status, razorpay_payment_id, refund_status, refund_id, total_amount",
    )
    .maybeSingle();

  if (error) {
    console.error("[admin/orders update]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Auto-refund on admin cancel — PAID orders only. Same paid-only gate + DB
  // compare-and-swap as the customer cancel path. Admin may cancel outside the
  // 1-hour window (the full-refund promise still applies), but the gate ensures
  // COD/unpaid orders are NEVER refunded.
  let refundOutcome: "none" | "processing" | "failed" = "none";
  if (update.status === "cancelled" && updated && canAutoRefund(updated)) {
    const { data: reserved, error: reserveErr } = await supabaseAdmin
      .from("orders")
      .update({ refund_status: "processing" })
      .eq("id", params.id)
      .is("refund_status", null)
      .is("refund_id", null)
      .select("id")
      .maybeSingle();
    if (reserveErr) {
      // The reserve write itself failed (e.g. a DB constraint rejected it). This
      // must NEVER masquerade as "no refund needed" — surface it as a failure so
      // it can be processed manually. The order still stays cancelled.
      refundOutcome = "failed";
      console.error(
        `[admin/orders cancel] REFUND RESERVE FAILED for order ${params.id}: ${reserveErr.message} — manual refund may be needed`,
      );
    } else if (reserved) {
      const amountPaise = Math.round(Number(updated.total_amount) * 100);
      const result = await issueRazorpayRefund(
        updated.razorpay_payment_id as string,
        amountPaise,
        params.id,
      );
      if (result.ok) {
        refundOutcome = "processing";
        // refunded_at set later by the refund webhook (Phase C).
        await supabaseAdmin
          .from("orders")
          .update({ refund_id: result.refundId })
          .eq("id", params.id);
      } else {
        refundOutcome = "failed";
        await supabaseAdmin
          .from("orders")
          .update({ refund_status: "failed" })
          .eq("id", params.id);
        console.error("[admin/orders cancel] REFUND FAILED — manual action needed", {
          orderId: params.id,
          error: result.error,
          code: result.code,
          httpStatus: result.httpStatus,
        });
      }
    }
  }

  // Fire-and-forget push on a status transition we have copy for.
  // notifyCustomer never throws and never blocks — the admin gets their
  // 200 immediately regardless of push latency or token validity.
  if (
    updated?.customer_id &&
    typeof update.status === "string" &&
    STATUS_PUSH_COPY[update.status]
  ) {
    const copy = STATUS_PUSH_COPY[update.status];
    notifyCustomer(updated.customer_id, copy.title, copy.body, {
      kind: "order_status",
      order_id: updated.id,
      status: updated.status,
    });
  }

  const statusChanged =
    typeof update.status === "string" && before?.status !== update.status;
  const dateChanged =
    update.delivery_date !== undefined &&
    (before?.delivery_date ?? null) !== (update.delivery_date ?? null);
  const slotChanged =
    update.delivery_slot !== undefined &&
    (before?.delivery_slot ?? null) !== (update.delivery_slot ?? null);
  const schedulingChanged = dateChanged || slotChanged;

  // Build a human-readable context line that prioritises scheduling
  // edits — these are the ones admins make from phone-call requests
  // and the audit-log page needs to surface clearly.
  let context: string;
  if (schedulingChanged) {
    const finalDate = (update.delivery_date ?? before?.delivery_date ?? null) as string | null;
    const finalSlot = (update.delivery_slot ?? before?.delivery_slot ?? null) as string | null;
    const slotLabel = finalSlot ? formatSlotForDisplay(finalSlot) : "—";
    context = `Admin changed delivery to ${finalDate ?? "—"} ${slotLabel}`;
  } else if (statusChanged) {
    context = `Order status changed from "${before?.status ?? "—"}" to "${update.status as string}"`;
  } else {
    context = `Updated order ${params.id.slice(0, 8)}`;
  }

  void recordAuditEvent({
    req,
    entity: "order",
    action: statusChanged
      ? update.status === "cancelled"
        ? "cancel"
        : "status_change"
      : "update",
    targetId: params.id,
    targetLabel: `#${params.id.slice(0, 8)}`,
    context,
    meta: {
      fields: Object.keys(update),
      ...(statusChanged
        ? { status_before: before?.status ?? null, status_after: update.status }
        : {}),
      ...(dateChanged
        ? { delivery_date_before: before?.delivery_date ?? null, delivery_date_after: update.delivery_date ?? null }
        : {}),
      ...(slotChanged
        ? { delivery_slot_before: before?.delivery_slot ?? null, delivery_slot_after: update.delivery_slot ?? null }
        : {}),
    },
  });

  return NextResponse.json({ ok: true, refund_status: refundOutcome });
}
