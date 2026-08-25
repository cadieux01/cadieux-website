// GET /api/mobile/orders/[id]
//
// Returns a single order's full details for the verified-phone customer that
// owns it. Used by the mobile app's order tracking screen, which polls this
// endpoint (~20s) instead of refetching the whole list. Mirrors the web
// /api/orders/[id] route but uses mobile auth (X-App-Key + bearer) and scopes
// the order to the customer resolved from the verified phone.
//
// Defensive ordering (bad actors assumed):
//   1. App key + verified bearer (same as every other mobile route).
//   2. Resolve the customer row from the verified phone.
//   3. Resolve the order, scoped to that customer_id. Mismatch → 404, not
//      403, so we don't leak the existence of unrelated orders.
//
// The Supabase service-role key never leaves the server — only the selected,
// customer_id-stripped order row is returned to the client.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone, isValidMobileAppKey } from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";
import { computeOrderState } from "@/lib/order-state";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function fail(status: number, error: string, code?: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  // ----- 1. Auth -----
  if (!process.env.MOBILE_APP_KEY) return fail(500, "Server misconfigured");
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return fail(401, "Unauthorized");
  }
  const verified = getVerifiedPhone(req);
  if (!verified) return fail(401, "Phone not verified");
  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) return fail(400, "Phone format");

  const orderId = (params.id || "").trim();
  if (!orderId) return fail(400, "Bad order id", "bad_id");

  // ----- 2. Customer -----
  const { data: customer, error: custErr } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (custErr) {
    console.error("[mobile/order detail] customer lookup:", custErr.message);
    return fail(500, "Lookup failed");
  }
  if (!customer) return fail(404, "Not found");

  // ----- 3. Order (scoped to this customer) -----
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select(
      "id, total_amount, delivery_fee, status, status_updated_at, delivery_address, items, delivery_date, delivery_slot, created_at, cancelled_at, cancellation_reason, refund_status, payment_method, payment_status, fulfillment_type, pickup_location_id, pickup_ready_at, picked_up_at, is_preorder, scheduled_delivery_date_by, scheduled_delivery_date_at",
    )
    .eq("id", orderId)
    .eq("customer_id", customer.id)
    .maybeSingle();
  if (orderErr) {
    console.error("[mobile/order detail] order lookup:", orderErr.message);
    return fail(500, "Lookup failed");
  }
  if (!order) return fail(404, "Not found");

  // ----- 4. Active pending change request (if any) -----
  // The app shows a pending Pay Now / delivery / item change card and hides
  // Pay Now while a request is outstanding. There is at most one pending
  // request per order (DB partial-unique index), but order by created_at desc
  // + limit 1 defensively.
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

  // Attach computed_state (mirror of the bot's classifyOrder). Old app
  // installs will ignore this new field; a future app build (Phase 2) can
  // read it to render the "expired" terminal state on the tracker.
  const computed_state = computeOrderState(order);
  return NextResponse.json({
    ok: true,
    order: { ...order, computed_state },
    change_request: pendingRequest ?? null,
  });
}
