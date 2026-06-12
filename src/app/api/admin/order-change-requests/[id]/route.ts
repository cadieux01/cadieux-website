import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";

// PATCH /api/admin/order-change-requests/[id]
//   body: { action: "approve" | "reject", admin_response?: string }
//
// Approve →
//   - type 'delivery': calls the SECURITY DEFINER RPC
//     approve_order_change_request, which atomically re-checks eligibility
//     (not cancelled; paid OR COD-unpaid; address not on a paid order) and
//     applies the requested delivery fields.
//   - type 'items': recomputes the full items array + total SERVER-SIDE from
//     the order's CURRENT price snapshot + requested quantities, then calls
//     apply_order_item_change to atomically re-check (COD/unpaid/not-cancelled)
//     and write them. The stored requested_total_amount is never trusted.
// Reject → marks the request rejected (+ admin_response) and leaves the order
// untouched. Mirrors /api/admin/change-requests/[id].

type OrderItem = {
  slug?: string;
  name?: string;
  qty?: number;
  kind?: "once" | "sub";
  price_inr?: number;
  line_total?: number;
};

// Maps the RPC's raised messages to a human sentence + HTTP status.
const RPC_ERRORS: Record<string, { status: number; message: string }> = {
  request_not_found: { status: 404, message: "Request not found." },
  request_not_pending: { status: 409, message: "This request was already resolved." },
  order_not_found: { status: 404, message: "Order not found." },
  order_not_cod: { status: 409, message: "Order is no longer Cash on Delivery." },
  order_already_paid: { status: 409, message: "Order has already been paid." },
  order_cancelled: { status: 409, message: "Order has been cancelled." },
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "").toLowerCase();
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  const adminResponse =
    typeof body.admin_response === "string" && body.admin_response.trim()
      ? body.admin_response.trim()
      : null;

  const { data: cr } = await supabaseAdmin
    .from("order_change_requests")
    .select(
      "id, order_id, status, type, requested_delivery_date, requested_delivery_slot, requested_delivery_address, requested_items, requested_total_amount",
    )
    .eq("id", params.id)
    .maybeSingle();
  if (!cr) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (cr.status !== "pending") {
    return NextResponse.json({ error: "Already resolved" }, { status: 400 });
  }

  if (action === "approve") {
    let rpcErr: { message?: string } | null = null;

    if (cr.type === "items") {
      // Item-quantity approve: recompute the full items array + total
      // SERVER-SIDE from the order's CURRENT price snapshot + the requested
      // per-line quantities. Never trust the stored requested_total_amount.
      const { data: order, error: orderErr } = await supabaseAdmin
        .from("orders")
        .select("items, delivery_fee")
        .eq("id", cr.order_id)
        .maybeSingle();
      if (orderErr) {
        console.error("[admin/order-change-requests approve items]", orderErr.message);
        return NextResponse.json({ error: orderErr.message }, { status: 500 });
      }
      if (!order) {
        return NextResponse.json({ error: "Order not found." }, { status: 404 });
      }

      const reqMap = new Map(
        ((cr.requested_items ?? []) as { slug: string; qty: number }[]).map(
          (r) => [r.slug, Number(r.qty)] as const,
        ),
      );
      const orderItems = (order.items ?? []) as OrderItem[];
      let subtotal = 0;
      const newItems = orderItems.map((it) => {
        if (
          it &&
          it.kind !== "sub" &&
          typeof it.slug === "string" &&
          reqMap.has(it.slug)
        ) {
          const qty = reqMap.get(it.slug) as number;
          const price = Number(it.price_inr ?? 0);
          const lineTotal = price * qty;
          subtotal += lineTotal;
          return { ...it, qty, line_total: lineTotal };
        }
        const line =
          typeof it?.line_total === "number"
            ? it.line_total
            : Number(it?.price_inr ?? 0) * Number(it?.qty ?? 0);
        subtotal += line;
        return it;
      });
      const total = subtotal + Number(order.delivery_fee ?? 0);

      const { error } = await supabaseAdmin.rpc("apply_order_item_change", {
        p_id: params.id,
        p_items: newItems,
        p_total: total,
      });
      rpcErr = error;
    } else {
      // Delivery approve: atomic re-check + apply inside the RPC transaction.
      const { error } = await supabaseAdmin.rpc("approve_order_change_request", {
        p_id: params.id,
      });
      rpcErr = error;
    }

    if (rpcErr) {
      const key = (rpcErr.message || "").trim();
      const mapped = RPC_ERRORS[key];
      if (mapped) {
        return NextResponse.json({ error: mapped.message }, { status: mapped.status });
      }
      console.error("[admin/order-change-requests approve]", rpcErr.message);
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }
    // Record the admin_response on the now-approved row (RPC doesn't take it).
    if (adminResponse) {
      await supabaseAdmin
        .from("order_change_requests")
        .update({ admin_response: adminResponse })
        .eq("id", params.id);
    }
  } else {
    const { error } = await supabaseAdmin
      .from("order_change_requests")
      .update({
        status: "rejected",
        admin_response: adminResponse,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", params.id)
      .eq("status", "pending");
    if (error) {
      console.error("[admin/order-change-requests reject]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const isItems = cr.type === "items";
  void recordAuditEvent({
    req,
    entity: "delivery_request",
    action: "update",
    targetId: cr.order_id,
    targetLabel: `#${cr.order_id.slice(0, 8)}`,
    context: `${isItems ? "Item" : "Delivery"} change request ${action === "approve" ? "approved" : "rejected"}`,
    meta: {
      change_request_id: params.id,
      type: cr.type ?? "delivery",
      action,
      requested_delivery_date: cr.requested_delivery_date,
      requested_delivery_slot: cr.requested_delivery_slot,
      requested_delivery_address: cr.requested_delivery_address,
      requested_items: cr.requested_items,
      requested_total_amount: cr.requested_total_amount,
      admin_response: adminResponse,
    },
  });

  return NextResponse.json({ ok: true });
}
