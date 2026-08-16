import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { computeOrderState } from "@/lib/order-state";
import {
  orderInsertColumns,
  prepareOneTimeOrder,
} from "@/lib/order-checkout";
import { recordAuditEvent } from "@/lib/audit-log";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, order_number, customer_id, total_amount, status, payment_method, payment_status, delivery_address, delivery_date, delivery_slot, items, created_at, latitude, longitude, fulfillment_type, pickup_location_id, pickup_ready_at, picked_up_at, customers(id, full_name, phone, city)"
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[admin/orders list]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Side-fetch pickup_locations for any order that references one. Done as a
  // manual join (rather than a PostgREST embed) because there's no FK between
  // orders.pickup_location_id and pickup_locations.id yet.
  const rows = data ?? [];
  const pickupIds = Array.from(
    new Set(
      rows
        .map((r: { pickup_location_id?: string | null }) => r.pickup_location_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );
  let pickupById: Record<string, { id: string; name: string; area: string; address: string }> = {};
  if (pickupIds.length > 0) {
    const { data: locs } = await supabaseAdmin
      .from("pickup_locations")
      .select("id, name, area, address")
      .in("id", pickupIds);
    for (const l of locs ?? []) {
      pickupById[l.id] = l;
    }
  }
  // Attach computed_state on every row so admin filters / badges never need
  // to duplicate the classifier. See src/lib/order-state.ts (mirrors the
  // WhatsApp bot's classifyOrder — the single source of truth for "expired").
  const nowMs = Date.now();
  const enriched = rows.map((r: {
    pickup_location_id?: string | null;
    status?: string | null;
    payment_status?: string | null;
    created_at?: string | null;
  }) => ({
    ...r,
    pickup_location: r.pickup_location_id ? pickupById[r.pickup_location_id] ?? null : null,
    computed_state: computeOrderState(r, nowMs),
  }));

  return NextResponse.json({ orders: enriched });
}

// POST /api/admin/orders — manual order entry ("Register New Order").
//
// Admin-only. Reuses prepareOneTimeOrder + orderInsertColumns so the row
// is byte-identical to a real customer-placed order (auto-refund gate,
// tracking page, mobile /api/mobile/orders, WhatsApp bot classifier and
// the admin list/print pages all keep working unchanged).
//
// Customer linking: we upsert public.customers by 10-digit local phone
// (the same key mobile/checkout uses). If a row already exists we NEVER
// overwrite full_name/city — only fill them when the current value is
// null/blank, so an existing customer's saved profile is safe.
//
// Serviceability override (`serviceabilityOverride: true`): skips ONLY
// the pincode + >20km gates in prepareOneTimeOrder. Every other gate —
// price, date, slot, item shape, phone-match — stays hard. See
// PrepareOptions.skipServiceability in src/lib/order-checkout.ts.
//
// Nothing on the PUBLIC checkout path is touched; the override flag is
// only ever set here, on an isAdmin()-gated endpoint.
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // 1. Phone normalisation — 10-digit local. Rejects garbage before we
  //    ever touch the DB. Matches the format customers.phone stores +
  //    the customers_phone_unique index keys on.
  const rawPhone = typeof body.phone === "string" ? body.phone : "";
  const phoneLocal = rawPhone.replace(/\D/g, "").slice(-10);
  if (phoneLocal.length !== 10) {
    return NextResponse.json(
      { error: "Please enter a valid 10-digit phone." },
      { status: 400 },
    );
  }

  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  if (!fullName) {
    return NextResponse.json({ error: "Customer name is required." }, { status: 400 });
  }
  const city = typeof body.city === "string" ? body.city.trim() : "";

  // 2. Customer upsert by phone — never overwrite existing name/city.
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("customers")
    .select("id, full_name, city")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (lookupErr) {
    console.error("[admin/orders POST] customer lookup failed:", lookupErr.message);
    return NextResponse.json(
      { error: "Failed to resolve customer" },
      { status: 500 },
    );
  }

  let customerId: string;
  if (existing) {
    // Only fill blanks — DO NOT clobber a saved profile. Admin form
    // pre-fills existing name/city read-only, but this is the belt-and-
    // braces guarantee at the API layer.
    const patch: Record<string, string> = {};
    if (!existing.full_name && fullName) patch.full_name = fullName;
    if (!existing.city && city) patch.city = city;
    if (Object.keys(patch).length > 0) {
      const { error: updErr } = await supabaseAdmin
        .from("customers")
        .update(patch)
        .eq("id", existing.id);
      if (updErr) {
        console.error("[admin/orders POST] customer fill failed:", updErr.message);
      }
    }
    customerId = existing.id;
  } else {
    const { data: newCust, error: insErr } = await supabaseAdmin
      .from("customers")
      .insert({
        full_name: fullName,
        phone: phoneLocal,
        ...(city ? { city } : {}),
      })
      .select("id")
      .single();
    if (insErr || !newCust) {
      console.error("[admin/orders POST] customer insert failed:", insErr?.message);
      return NextResponse.json(
        { error: "Failed to create customer" },
        { status: 500 },
      );
    }
    customerId = newCust.id;
  }

  // 3. Run the SAME validation pipeline the public checkout uses.
  //    OTP gate is already soft: with no cookie, effectiveVerifiedPhone
  //    falls back to the customer's stored phone → passes automatically.
  const serviceabilityOverride = body.serviceability_override === true;
  const bodyForPrep = { ...body, customer_id: customerId } as Record<string, unknown>;
  const prep = await prepareOneTimeOrder(bodyForPrep, req, supabaseAdmin, {
    skipServiceability: serviceabilityOverride,
  });
  if (!prep.ok) {
    return NextResponse.json(prep.body, { status: prep.status });
  }
  const prepared = prep.data;

  // 4. Payment + status. Manual "paid" orders are cash-collected (no
  //    razorpay_payment_id) so canAutoRefund() correctly returns false —
  //    the auto-refund guard in lib/order-cancellation.ts will not fire.
  const isPaid = body.payment === "paid";
  const rawStatus = typeof body.status === "string" ? body.status.toLowerCase() : "pending";
  const ALLOWED_CREATE_STATUSES = new Set(["pending", "placed", "confirmed"]);
  const status = ALLOWED_CREATE_STATUSES.has(rawStatus) ? rawStatus : "pending";

  const insertRow: Record<string, unknown> = {
    ...orderInsertColumns(prepared),
    status,
    payment_method: "cod",
    payment_status: isPaid ? "paid" : "pending",
  };
  if (isPaid) {
    insertRow.paid_at = new Date().toISOString();
  }

  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .insert(insertRow)
    .select("id, customer_id, total_amount, status, payment_status")
    .single();

  if (orderErr || !order) {
    console.error("[admin/orders POST] order insert failed:", orderErr?.message);
    return NextResponse.json(
      { error: "Failed to create order", details: orderErr?.message },
      { status: 500 },
    );
  }

  void recordAuditEvent({
    req,
    entity: "order",
    action: "create",
    targetId: order.id,
    targetLabel: `#${order.id.slice(0, 8)}`,
    context: `Admin manually registered order for ${phoneLocal}${serviceabilityOverride ? " (serviceability override)" : ""}`,
    meta: {
      phone: phoneLocal,
      customer_id: customerId,
      fulfillment_type: prepared.fulfillmentType,
      total_amount: prepared.grandTotal,
      delivery_fee: prepared.deliveryFee,
      distance_km: prepared.distanceKm,
      serviceability_override: serviceabilityOverride,
      payment: isPaid ? "paid" : "cod",
      status,
    },
  });

  return NextResponse.json({
    ok: true,
    order_id: order.id,
    customer_id: customerId,
    total_amount: prepared.grandTotal,
    delivery_fee: prepared.deliveryFee,
  });
}
