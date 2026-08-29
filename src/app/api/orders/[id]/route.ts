// /api/orders/[id]
// Returns a single order's full details for the verified-phone customer
// that owns it. Used by the web order detail page (/orders/[id]) and
// the post-checkout "View Order" link on /checkout/success.
//
// Auth: cookie-based via getVerifiedPhone(req). The order's customer must
// match the verified phone, otherwise we respond 404 (not 403 — don't leak
// the existence of unrelated orders).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone } from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";
import { computeOrderState } from "@/lib/order-state";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
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

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, order_number, total_amount, delivery_fee, status, status_updated_at, delivery_address, items, delivery_date, delivery_slot, created_at, cancelled_at, cancellation_reason, refund_status, payment_method, payment_status, customer_id, fulfillment_type, pickup_location_id, pickup_ready_at, picked_up_at, is_preorder, scheduled_delivery_date_by, scheduled_delivery_date_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[orders/[id]] fetch failed:", error.message);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
  if (!order || order.customer_id !== customer.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Active (pending) delivery change-request, if any. The tracking page uses
  // it to render the "Request pending" card (old→new diff) and to hide Pay Now
  // while a change is awaiting admin approval.
  const { data: pendingRequest } = await supabaseAdmin
    .from("order_change_requests")
    .select(
      "id, status, type, requested_delivery_date, requested_delivery_slot, requested_delivery_address, requested_items, requested_total_amount, reason, created_at",
    )
    .eq("order_id", order.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Side-fetch the pickup_location (no FK to embed via PostgREST) if this
  // order is a pickup. Cheap: at most one row.
  let pickupLocation: { id: string; name: string; area: string; address: string } | null = null;
  if (order.pickup_location_id) {
    const { data: loc } = await supabaseAdmin
      .from("pickup_locations")
      .select("id, name, area, address")
      .eq("id", order.pickup_location_id)
      .maybeSingle();
    if (loc) pickupLocation = loc;
  }

  // Strip customer_id from the response — the client doesn't need it.
  const { customer_id: _omit, ...rest } = order;
  void _omit;
  // Attach computed_state (mirror of the bot's classifyOrder). The customer
  // tracker uses this to render the "expired" terminal state + hide Pay Now
  // on stale unpaid orders. See src/lib/order-state.ts.
  const computed_state = computeOrderState(order);
  return NextResponse.json({
    order: { ...rest, pickup_location: pickupLocation, computed_state },
    change_request: pendingRequest ?? null,
  });
}
