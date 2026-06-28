// POST /api/mobile/orders/[id]/address-change-request
//
// Mobile counterpart of /api/orders/[id]/address-change-request. Same intent
// — let a customer request an address change on an UNPAID order (ANY
// payment method), pending admin approval.
//
// Auth: X-App-Key + bearer (getVerifiedPhone) + owner-by-phone (404 on
// mismatch).
//
// Gates (mirror the web route):
//   - cancelled order  → 409 'cancelled'
//   - paid order       → 409 'address_locked_paid' (paid orders are LOCKED;
//                        the address can change the delivery fee, so once
//                        money has been collected the address is fixed)
//   - new address must differ from the current one
//   - new address must end in a 6-digit pincode AND be serviceable
//     (customers can't redirect to a no-go zone via change-request; if they
//     need that, they should send a delivery request instead)
//
// Single-pending rule: any existing pending request for this order (ANY
// type) is cancelled first so the partial-unique index never trips. The
// inserted row has type='address' and only `requested_delivery_address`
// populated; date/slot are NULL.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone, isValidMobileAppKey } from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";
import { normalizePincode, resolveServiceability } from "@/lib/service-areas";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function fail(status: number, error: string, code?: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

export async function POST(
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

  const body = (await req.json().catch(() => ({}))) as {
    requested_delivery_address?: unknown;
    reason?: unknown;
  };

  const reqAddress =
    typeof body.requested_delivery_address === "string" &&
    body.requested_delivery_address.trim()
      ? body.requested_delivery_address.trim()
      : null;
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : null;

  if (!reqAddress) return fail(400, "Provide a new address.");
  if (reqAddress.length > 500) return fail(400, "Address is too long.");

  // ----- 2. Customer -----
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (!customer) return fail(404, "Not found");

  // ----- 3. Order (scoped to this customer) -----
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select(
      "id, customer_id, status, payment_method, payment_status, delivery_address",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr) {
    console.error(
      "[mobile/address-change-request] order fetch failed:",
      orderErr.message,
    );
    return fail(500, "Failed to load order");
  }
  if (!order || order.customer_id !== customer.id) {
    return fail(404, "Order not found.");
  }

  // ----- 4. Gates -----
  if ((order.status ?? "").toLowerCase() === "cancelled") {
    return fail(409, "This order is cancelled.", "cancelled");
  }
  if ((order.payment_status ?? "").toLowerCase() === "paid") {
    return fail(
      409,
      "The delivery address can't be changed on a paid order.",
      "address_locked_paid",
    );
  }
  if (reqAddress === (order.delivery_address ?? null)) {
    return fail(400, "Nothing changed — enter a different address.");
  }

  // Pincode serviceability check (same convention as the web route + as
  // checkout's pinFromAddress: the 6-digit suffix of the address).
  const pinFromAddress = reqAddress.match(/(\d{6})\s*$/)?.[1] ?? null;
  const pincode = pinFromAddress ? normalizePincode(pinFromAddress) : null;
  if (!pincode) {
    return fail(400, "Address must end with a 6-digit pincode.");
  }
  const serviceability = await resolveServiceability(pincode);
  if (!serviceability.serviceable) {
    return fail(
      400,
      "We don't deliver to this pincode yet. Send us a delivery request and we'll get in touch.",
      "pincode_unserviceable",
    );
  }

  // ----- 5. Single-pending replace -----
  await supabaseAdmin
    .from("order_change_requests")
    .update({ status: "cancelled", resolved_at: new Date().toISOString() })
    .eq("order_id", order.id)
    .eq("status", "pending");

  const { data: cr, error: insErr } = await supabaseAdmin
    .from("order_change_requests")
    .insert({
      order_id: order.id,
      type: "address",
      status: "pending",
      requested_delivery_date: null,
      requested_delivery_slot: null,
      requested_delivery_address: reqAddress,
      reason,
    })
    .select(
      "id, type, status, requested_delivery_address, reason, created_at",
    )
    .single();

  if (insErr || !cr) {
    console.error(
      "[mobile/address-change-request] insert failed:",
      insErr?.message,
    );
    return fail(500, "Failed to submit request");
  }

  return NextResponse.json({ ok: true, request: cr });
}
