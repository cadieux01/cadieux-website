// POST /api/orders/[id]/change-request
//
// Customer-facing "request a delivery change" for an EXISTING COD order.
// The order itself does NOT change here — we record a PENDING
// order_change_requests row (date / slot / address) that an admin later
// approves or rejects. Mirrors the subscription change-request flow.
//
// Owner-scoped (cookie/bearer auth via getVerifiedPhone → customer by
// phone → order scoped to customer_id; 404 on mismatch so we never leak
// other customers' orders).
//
// Guards:
//   - order must be COD, not paid, not cancelled (else 409)
//   - at least one requested field must differ from the order's current value
//   - if a date and/or slot is requested, it must pass the 12h10m booking lead
//     rule (validateBookingSlot) — same gate as checkout
// "Replace": any existing pending request for this order is cancelled first,
// so there is only ever ONE pending request per order (also DB-enforced by a
// partial unique index).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getVerifiedPhone,
  rollPhoneCookieOnWebRequest,
} from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";
import { isIsoDate, isValidSlotValue, validateBookingSlot } from "@/lib/delivery-slots";

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
    requested_delivery_date?: unknown;
    requested_delivery_slot?: unknown;
    requested_delivery_address?: unknown;
    reason?: unknown;
  };

  // Normalise inputs: a field is "requested" only when it's a non-empty
  // string. Anything else (missing / null / wrong type) → not requested.
  const reqDate =
    typeof body.requested_delivery_date === "string" &&
    body.requested_delivery_date.trim()
      ? body.requested_delivery_date.trim()
      : null;
  const reqSlot =
    typeof body.requested_delivery_slot === "string" &&
    body.requested_delivery_slot.trim()
      ? body.requested_delivery_slot.trim()
      : null;
  const reqAddress =
    typeof body.requested_delivery_address === "string" &&
    body.requested_delivery_address.trim()
      ? body.requested_delivery_address.trim()
      : null;
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : null;

  if (!reqDate && !reqSlot && !reqAddress) {
    return NextResponse.json(
      { error: "Provide a new date, slot, or address." },
      { status: 400 },
    );
  }

  // Validate shapes up-front (cheap, before any DB work).
  if (reqDate && !isIsoDate(reqDate)) {
    return NextResponse.json({ error: "Invalid delivery date." }, { status: 400 });
  }
  if (reqSlot && !isValidSlotValue(reqSlot)) {
    return NextResponse.json({ error: "Invalid delivery slot." }, { status: 400 });
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
      "id, customer_id, status, payment_method, payment_status, delivery_date, delivery_slot, delivery_address",
    )
    .eq("id", id)
    .maybeSingle();
  if (orderErr) {
    console.error("[orders/change-request] order fetch failed:", orderErr.message);
    return NextResponse.json({ error: "Failed to load order" }, { status: 500 });
  }
  if (!order || order.customer_id !== customer.id) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  // Editable scope:
  //   - not cancelled (always required)
  //   - date/slot: allowed on a PAID order (any method) OR a COD-unpaid order
  //   - address: COD-unpaid only — it can change the delivery fee and a paid
  //     order has already been charged.
  const isPaid = (order.payment_status ?? "").toLowerCase() === "paid";
  const isCod = (order.payment_method ?? "").toLowerCase() === "cod";
  if ((order.status ?? "").toLowerCase() === "cancelled") {
    return NextResponse.json(
      { error: "This order is cancelled.", code: "cancelled" },
      { status: 409 },
    );
  }
  if (!isPaid && !isCod) {
    return NextResponse.json(
      { error: "Delivery changes are only available for Cash on Delivery orders.", code: "not_cod" },
      { status: 409 },
    );
  }
  if (isPaid && reqAddress) {
    return NextResponse.json(
      {
        error:
          "The delivery address can't be changed on a paid order. You can still change the date or time.",
        code: "address_locked_paid",
      },
      { status: 409 },
    );
  }

  // At least one field must actually differ from the current order value.
  const dateChanges = reqDate !== null && reqDate !== (order.delivery_date ?? null);
  const slotChanges = reqSlot !== null && reqSlot !== (order.delivery_slot ?? null);
  const addressChanges =
    reqAddress !== null && reqAddress !== (order.delivery_address ?? null);
  if (!dateChanges && !slotChanges && !addressChanges) {
    return NextResponse.json(
      { error: "Nothing changed — pick a different date, slot, or address." },
      { status: 400 },
    );
  }

  // Booking-lead rule on the requested date/slot. Apply when either is being
  // changed: validate the requested date against the requested slot, falling
  // back to the order's current value for whichever side isn't changing.
  if (dateChanges || slotChanges) {
    const effDate = reqDate ?? order.delivery_date;
    const effSlot = reqSlot ?? order.delivery_slot;
    const slotErr = validateBookingSlot(effDate, effSlot);
    if (slotErr) {
      return NextResponse.json(
        { error: slotErr.error, code: slotErr.code },
        { status: slotErr.status },
      );
    }
  }

  // Replace: void any existing pending request for this order first, so the
  // partial-unique index never trips and the new one is the only pending.
  await supabaseAdmin
    .from("order_change_requests")
    .update({ status: "cancelled", resolved_at: new Date().toISOString() })
    .eq("order_id", order.id)
    .eq("status", "pending");

  const { data: cr, error: insErr } = await supabaseAdmin
    .from("order_change_requests")
    .insert({
      order_id: order.id,
      type: "delivery",
      status: "pending",
      requested_delivery_date: dateChanges ? reqDate : null,
      requested_delivery_slot: slotChanges ? reqSlot : null,
      requested_delivery_address: addressChanges ? reqAddress : null,
      reason,
    })
    .select(
      "id, status, requested_delivery_date, requested_delivery_slot, requested_delivery_address, reason, created_at",
    )
    .single();

  if (insErr || !cr) {
    console.error("[orders/change-request] insert failed:", insErr?.message);
    return NextResponse.json(
      { error: "Failed to submit request", details: insErr?.message },
      { status: 500 },
    );
  }

  const res = NextResponse.json({ ok: true, request: cr });
  rollPhoneCookieOnWebRequest(req, res);
  return res;
}
