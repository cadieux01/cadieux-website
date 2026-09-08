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

  // full_name/phone are selected for the customer's own share message.
  // This is the caller's own name and own number going back to the session
  // that just proved ownership of that number, so it discloses nothing the
  // caller didn't already supply — but it is PII, and the ownership check
  // twenty lines below is the only thing keeping it that way.
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id, full_name, phone")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (!customer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select(
      // order_number (OLF<n>) is deliberately NOT selected. The whole row
      // is spread into the response a customer's browser receives, and the
      // OLF number is sequential — it would disclose our order volume.
      // public_ref is the customer-facing reference. That reasoning gets
      // STRONGER for the share message, not weaker: a share message is
      // built to be forwarded, so an OLF number in one leaks the count to
      // everyone downstream of the customer too.
      //
      // latitude/longitude ARE selected. They are the coordinates of the
      // address this customer typed, and without them the share message's
      // maps link degrades from a dropped pin to a text search — materially
      // worse for whoever is actually driving there.
      "id, public_ref, total_amount, delivery_fee, status, status_updated_at, delivery_address, latitude, longitude, items, delivery_date, delivery_slot, created_at, cancelled_at, cancellation_reason, refund_status, payment_method, payment_status, customer_id, fulfillment_type, pickup_location_id, pickup_ready_at, picked_up_at, is_preorder, scheduled_delivery_date_by, scheduled_delivery_date_at",
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
  // lat/lng are selected so a shared pickup order links to a pin on the
  // store rather than a text search for its address — every pickup_locations
  // row carries coordinates, unlike older orders.
  let pickupLocation: {
    id: string;
    name: string;
    area: string;
    address: string;
    latitude: number | null;
    longitude: number | null;
  } | null = null;
  if (order.pickup_location_id) {
    const { data: loc } = await supabaseAdmin
      .from("pickup_locations")
      .select("id, name, area, address, latitude, longitude")
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
    order: {
      ...rest,
      pickup_location: pickupLocation,
      computed_state,
      // The verified caller's own name and number, echoed back for the
      // share message. Reached only after the ownership check above.
      customer: {
        full_name: customer.full_name ?? null,
        phone: customer.phone ?? null,
      },
    },
    change_request: pendingRequest ?? null,
  });
}
