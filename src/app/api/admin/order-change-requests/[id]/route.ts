import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";

// PATCH /api/admin/order-change-requests/[id]
//   body: { action: "approve" | "reject", admin_response?: string }
//
// Approve → calls the SECURITY DEFINER RPC approve_order_change_request, which
// atomically re-checks the order is still COD / not-paid / not-cancelled and
// the request is still pending, then applies the requested delivery fields to
// the order and marks the request approved. We never trust the list snapshot.
// Reject → marks the request rejected (+ admin_response) and leaves the order
// untouched. Mirrors /api/admin/change-requests/[id].

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
      "id, order_id, status, requested_delivery_date, requested_delivery_slot, requested_delivery_address",
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
    // Atomic re-check + apply + resolve, all inside the RPC's transaction.
    const { error: rpcErr } = await supabaseAdmin.rpc(
      "approve_order_change_request",
      { p_id: params.id },
    );
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

  void recordAuditEvent({
    req,
    entity: "delivery_request",
    action: "update",
    targetId: cr.order_id,
    targetLabel: `#${cr.order_id.slice(0, 8)}`,
    context: `Delivery change request ${action === "approve" ? "approved" : "rejected"}`,
    meta: {
      change_request_id: params.id,
      action,
      requested_delivery_date: cr.requested_delivery_date,
      requested_delivery_slot: cr.requested_delivery_slot,
      requested_delivery_address: cr.requested_delivery_address,
      admin_response: adminResponse,
    },
  });

  return NextResponse.json({ ok: true });
}
