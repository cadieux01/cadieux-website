import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import {
  BULK_PIN_MAX,
  PIN_GATED_ORDER_STATUSES,
  orderPinErrorResponse,
  requireOrderPin,
} from "@/lib/order-pin";
import { notifyCustomer } from "@/lib/push";

// Bulk status transition. Mirrors the single-order PATCH endpoint's
// validation and push side-effects, but processes a list and returns
// a per-row succeeded/failed report so the UI can show a result modal
// rather than aborting on the first failure.
//
// Body shape:
//   { orderIds: string[], action: "confirm" | "dispatch" | "deliver" | "cancel" }
//
// Response shape:
//   { succeeded: string[], failed: { id: string; error: string }[] }

const ACTION_TO_STATUS: Record<string, string> = {
  confirm: "confirmed",
  prepare: "preparing",
  dispatch: "out_for_delivery",
  deliver: "delivered",
  cancel: "cancelled",
};

const STATUS_PUSH_COPY: Record<string, { title: string; body: string }> = {
  confirmed: { title: "Order confirmed", body: "Your bread is being prepared." },
  preparing: { title: "Preparing your order", body: "We're baking your bread now." },
  out_for_delivery: { title: "On the way", body: "Your order is on the way!" },
  delivered: { title: "Delivered", body: "Your bread has been delivered. Enjoy!" },
  cancelled: { title: "Order cancelled", body: "Your order has been cancelled." },
};

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.orderIds) ? body.orderIds.filter((x: unknown) => typeof x === "string") : [];
  const action = typeof body.action === "string" ? body.action : "";
  const nextStatus = ACTION_TO_STATUS[action];

  if (!nextStatus) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  if (ids.length === 0) {
    return NextResponse.json({ error: "No order ids provided" }, { status: 400 });
  }
  // Sanity cap. An admin updating more than 200 orders at once is almost
  // certainly a UI bug, and we'd rather fail loudly than churn the DB.
  if (ids.length > 200) {
    return NextResponse.json({ error: "Too many orders in a single batch (max 200)" }, { status: 400 });
  }

  // ── ORDER PIN gate ──────────────────────────────────────────────────────────
  // Confirm and cancel are PIN-gated here exactly as they are on the
  // single-order PATCH. Without this, the bulk route would be a complete
  // bypass of the gate — it reaches the same statuses on the same table.
  //
  // One PIN entry authorises one batch, and a batch of these two actions is
  // capped at BULK_PIN_MAX. The 200 ceiling above still governs the other
  // actions (prepare/dispatch/deliver), which are not gated: they are
  // operational stages, not the money- and customer-visible transitions.
  if (PIN_GATED_ORDER_STATUSES.has(nextStatus)) {
    if (ids.length > BULK_PIN_MAX) {
      return NextResponse.json(
        {
          error: `You can ${action} at most ${BULK_PIN_MAX} orders at a time. You selected ${ids.length} — reduce the selection and try again.`,
          code: "bulk_pin_limit",
          max: BULK_PIN_MAX,
        },
        { status: 400 },
      );
    }
    const gate = await requireOrderPin(
      req,
      `${ids.length} order(s) (bulk ${action})`,
      {
        surface: "orders",
        scope: "bulk",
        status_after: nextStatus,
        // Every order ID in the batch, so the audit trail names exactly what
        // one PIN entry authorised rather than just how many.
        order_ids: ids,
      },
    );
    if (!gate.ok) return orderPinErrorResponse(gate);
  }

  const succeeded: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const id of ids) {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .update({ status: nextStatus, status_updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, customer_id, status")
      .maybeSingle();

    if (error || !data) {
      failed.push({ id, error: error?.message ?? "Order not found" });
      continue;
    }
    succeeded.push(data.id);

    void recordAuditEvent({
      req,
      entity: "order",
      action: nextStatus === "cancelled" ? "cancel" : "status_change",
      targetId: data.id,
      targetLabel: `#${data.id.slice(0, 8)}`,
      context: `Bulk ${action} → ${nextStatus} for order ${data.id.slice(0, 8)}`,
      meta: { bulk: true, action, status_after: nextStatus },
    });

    // Fire-and-forget push, identical to single-order PATCH semantics.
    const copy = STATUS_PUSH_COPY[nextStatus];
    if (data.customer_id && copy) {
      notifyCustomer(data.customer_id, copy.title, copy.body, {
        kind: "order_status",
        order_id: data.id,
        status: data.status,
      });
    }
  }

  // One batch-level record naming every order ID that this single PIN entry
  // authorised. The per-order entries above say what changed; this one says
  // what one PIN was spent on, which is the question an audit of the gate
  // actually asks.
  if (PIN_GATED_ORDER_STATUSES.has(nextStatus)) {
    void recordAuditEvent({
      req,
      entity: "order_pin",
      action: "other",
      targetId: null,
      targetLabel: "Order PIN",
      context: `Order PIN authorised a bulk ${action} of ${ids.length} order(s)`,
      meta: {
        surface: "orders",
        scope: "bulk",
        action,
        status_after: nextStatus,
        order_ids: ids,
        succeeded,
        failed: failed.map((f) => f.id),
      },
    });
  }

  return NextResponse.json({ succeeded, failed });
}
