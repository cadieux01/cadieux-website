// POST /api/orders/[id]/change-request/cancel
//
// Customer voids their own PENDING delivery change-request for an order,
// returning the order to normal (Pay Now becomes available again). The
// order row is never touched — only the pending request flips to
// 'cancelled'. Owner-scoped exactly like the create route. Idempotent:
// returns ok even when there was no pending request to cancel.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone } from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = (params.id || "").trim();
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }

  const verified = getVerifiedPhone(req);
  if (!verified) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) {
    return NextResponse.json({ error: "Phone format" }, { status: 400 });
  }

  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (!customer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Confirm the order belongs to this customer before touching its requests.
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id, customer_id")
    .eq("id", id)
    .maybeSingle();
  if (!order || order.customer_id !== customer.id) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const { error } = await supabaseAdmin
    .from("order_change_requests")
    .update({ status: "cancelled", resolved_at: new Date().toISOString() })
    .eq("order_id", order.id)
    .eq("status", "pending");
  if (error) {
    console.error("[orders/change-request/cancel] update failed:", error.message);
    return NextResponse.json({ error: "Failed to cancel request" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
