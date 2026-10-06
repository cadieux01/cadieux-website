import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { notifyCustomer } from "@/lib/push";
import {
  CONFIRM_OVERRIDE_FIELD,
  confirmNeedsPaymentOverride,
  confirmOverrideMessage,
} from "@/lib/order-confirm-guard";

// Bulk status transition. Mirrors the single-order PATCH endpoint's
// validation and push side-effects, but processes a list and returns
// a per-row succeeded/failed report so the UI can show a result modal
// rather than aborting on the first failure.
//
// Body shape:
//   { orderIds: string[], action: "confirm" | "dispatch" | "deliver" | "cancel",
//     allow_unpaid_confirm?: true }
//
// allow_unpaid_confirm overrides the unpaid-online-payment refusal on
// action:"confirm" — see @/lib/order-confirm-guard. It is all-or-nothing for the
// batch, which is deliberate: an override is a statement about a specific
// customer conversation, and one blanket flag covering 200 orders is not that.
// The honest way to override in bulk is to confirm the blocked ones one at a time
// from the board, where the refusal names the order.
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

  const succeeded: string[] = [];
  const failed: { id: string; error: string }[] = [];

  // The same unpaid-online-confirm refusal the single-order PATCH applies. The
  // admin board no longer offers bulk confirm (only cancel is still bulkable —
  // see runBulk in src/app/admin/orders/page.tsx), but this route still ACCEPTS
  // action:"confirm", and an endpoint that is reachable is an endpoint that will
  // be reached. Guarding only the UI path would leave the hole open for the next
  // caller.
  //
  // Read in ONE select rather than per row: the loop below already costs a write
  // per id, and this must not double the round trips. Ids missing here fall
  // through to the loop and fail there with "Order not found", which is the
  // answer they already gave.
  const unpaidBlocked = new Map<string, string>();
  if (nextStatus === "confirmed" && body[CONFIRM_OVERRIDE_FIELD] !== true) {
    const { data: rows, error: readErr } = await supabaseAdmin
      .from("orders")
      .select("id, order_number, status, payment_method, payment_status")
      .in("id", ids);
    if (readErr) {
      // Cannot prove these are safe to confirm, so confirm none of them. Failing
      // the batch is recoverable; confirming blind is what this guard exists to
      // stop.
      console.error("[admin/orders bulk] payment pre-read failed:", readErr.message);
      return NextResponse.json(
        { error: `Could not check payment state: ${readErr.message}` },
        { status: 500 },
      );
    }
    for (const row of rows ?? []) {
      if (row.status !== "confirmed" && confirmNeedsPaymentOverride(row)) {
        unpaidBlocked.set(row.id, confirmOverrideMessage(row));
      }
    }
  }

  for (const id of ids) {
    const blocked = unpaidBlocked.get(id);
    if (blocked) {
      failed.push({ id, error: blocked });
      continue;
    }
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
      context:
        `Bulk ${action} → ${nextStatus} for order ${data.id.slice(0, 8)}` +
        (nextStatus === "confirmed" && body[CONFIRM_OVERRIDE_FIELD] === true
          ? ` — unpaid-online confirm override was set for this batch`
          : ``),
      meta: {
        bulk: true,
        action,
        status_after: nextStatus,
        ...(nextStatus === "confirmed" && body[CONFIRM_OVERRIDE_FIELD] === true
          ? { unpaid_online_confirm_override: true }
          : {}),
      },
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

  return NextResponse.json({ succeeded, failed });
}
