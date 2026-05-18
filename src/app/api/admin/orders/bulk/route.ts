import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
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
  dispatch: "dispatched",
  deliver: "delivered",
  cancel: "cancelled",
};

const STATUS_PUSH_COPY: Record<string, { title: string; body: string }> = {
  confirmed: { title: "Order confirmed", body: "Your bread is being prepared." },
  dispatched: { title: "On the way", body: "Your order is on the way!" },
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

  for (const id of ids) {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .update({ status: nextStatus })
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

  return NextResponse.json({ succeeded, failed });
}
