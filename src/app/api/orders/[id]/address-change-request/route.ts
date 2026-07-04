// POST /api/orders/[id]/address-change-request
//
// Customer-facing "request an address change" for an UNPAID order (ANY
// payment method). Mirrors the type='delivery' /change-request route, but:
//   - dedicated type='address' row (clean separation from date/slot edits)
//   - strict UNPAID gate (payment_status != 'paid'); a paid order is LOCKED
//   - only `requested_delivery_address` is recorded; date/slot stay null
//
// Owner-scoped (cookie auth via getVerifiedPhone -> customer by phone ->
// order scoped to customer_id; 404 on mismatch so we never leak other
// customers' orders). Single-pending per order is enforced by the existing
// partial unique index (order_id where status='pending'); we cancel any
// existing pending (ANY type) first then insert.
//
// Also re-checks pincode serviceability so a customer can't redirect an
// order to a no-go zone — admin can still override by editing the order
// row directly, but the customer flow refuses to silently route there.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getVerifiedPhone,
  rollPhoneCookieOnWebRequest,
} from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";
import { normalizePincode, resolveServiceability } from "@/lib/service-areas";

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

  if (!reqAddress) {
    return NextResponse.json(
      { error: "Provide a new address." },
      { status: 400 },
    );
  }
  if (reqAddress.length > 500) {
    return NextResponse.json(
      { error: "Address is too long." },
      { status: 400 },
    );
  }

  // Resolve owner.
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (!customer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Locate the order, scoped to this customer.
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select(
      "id, customer_id, status, payment_method, payment_status, delivery_address",
    )
    .eq("id", id)
    .maybeSingle();
  if (orderErr) {
    console.error(
      "[orders/address-change-request] order fetch failed:",
      orderErr.message,
    );
    return NextResponse.json(
      { error: "Failed to load order" },
      { status: 500 },
    );
  }
  if (!order || order.customer_id !== customer.id) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  // Gates.
  if ((order.status ?? "").toLowerCase() === "cancelled") {
    return NextResponse.json(
      { error: "This order is cancelled.", code: "cancelled" },
      { status: 409 },
    );
  }
  if ((order.payment_status ?? "").toLowerCase() === "paid") {
    return NextResponse.json(
      {
        error:
          "The delivery address can't be changed on a paid order.",
        code: "address_locked_paid",
      },
      { status: 409 },
    );
  }

  // Must actually differ from the order's current value.
  if (reqAddress === (order.delivery_address ?? null)) {
    return NextResponse.json(
      { error: "Nothing changed — enter a different address." },
      { status: 400 },
    );
  }

  // Pincode serviceability check. Customers can't redirect an order to a
  // no-go zone via the change-request path; if they need to send to an
  // unserviceable pincode, they should submit a delivery request instead.
  // The pincode is the 6-digit suffix of the address (same convention as
  // checkout's pinFromAddress).
  const pinFromAddress = reqAddress.match(/(\d{6})\s*$/)?.[1] ?? null;
  const pincode = pinFromAddress ? normalizePincode(pinFromAddress) : null;
  if (!pincode) {
    return NextResponse.json(
      { error: "Address must end with a 6-digit pincode." },
      { status: 400 },
    );
  }
  const serviceability = await resolveServiceability(pincode);
  if (!serviceability.serviceable) {
    return NextResponse.json(
      {
        error:
          "We don't deliver to this pincode yet. Send us a delivery request and we'll get in touch.",
        code: "pincode_unserviceable",
      },
      { status: 400 },
    );
  }

  // Replace: void any existing pending request (ANY type) for this order so
  // the partial-unique index never trips and the new one is the only pending.
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
      "[orders/address-change-request] insert failed:",
      insErr?.message,
    );
    return NextResponse.json(
      { error: "Failed to submit request", details: insErr?.message },
      { status: 500 },
    );
  }

  const res = NextResponse.json({ ok: true, request: cr });
  rollPhoneCookieOnWebRequest(req, res);
  return res;
}
