import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { notifyCustomer } from "@/lib/push";

const ALLOWED_STATUSES = new Set([
  "pending",
  "confirmed",
  "dispatched",
  "delivered",
  "cancelled",
]);

// Customer-facing copy for the four push-triggering status transitions.
// Kept here (not in lib/push) because the wording is admin-flow specific.
const STATUS_PUSH_COPY: Record<string, { title: string; body: string }> = {
  confirmed: {
    title: "Order confirmed",
    body: "Your bread is being prepared.",
  },
  dispatched: {
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
};

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
    const s = body.status.toLowerCase();
    if (!ALLOWED_STATUSES.has(s)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    update.status = s;
  }

  if (typeof body.delivery_address === "string") {
    const addr = body.delivery_address.trim();
    if (!addr) {
      return NextResponse.json({ error: "Empty delivery_address" }, { status: 400 });
    }
    update.delivery_address = addr;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Capture the prior status so we can record a clean before/after on
  // the audit row when status changes.
  const { data: before } = await supabaseAdmin
    .from("orders")
    .select("status")
    .eq("id", params.id)
    .maybeSingle();

  const { data: updated, error } = await supabaseAdmin
    .from("orders")
    .update(update)
    .eq("id", params.id)
    .select("id, customer_id, status")
    .maybeSingle();

  if (error) {
    console.error("[admin/orders update]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
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
    context: statusChanged
      ? `Order status changed from "${before?.status ?? "—"}" to "${update.status as string}"`
      : `Updated order ${params.id.slice(0, 8)}`,
    meta: {
      fields: Object.keys(update),
      ...(statusChanged
        ? { status_before: before?.status ?? null, status_after: update.status }
        : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
