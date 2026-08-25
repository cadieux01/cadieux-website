// POST /api/mobile/create-order
//
// Online-payment (Razorpay) counterpart to /api/mobile/checkout. Runs the
// EXACT same auth + validation + server-authoritative pricing as the mobile
// COD path, then:
//   1. creates a Razorpay order for the server-derived grand total,
//   2. inserts a `pending` orders row up-front tagged with the
//      razorpay_order_id and payment_status='created'.
//
// The order is NEVER marked paid here — that only happens in
// /api/mobile/verify-payment after a server-side HMAC signature check.
// The amount sent to Razorpay is derived on the server; the client cannot
// influence it. The Razorpay KEY SECRET never leaves the server — the app
// only ever holds the public Key ID.
//
// Auth (identical to /api/mobile/checkout):
//   • X-App-Key friction header
//   • Authorization: Bearer <30-day phone token>
//
// Request body (same shape as /api/mobile/checkout):
//   { full_name, delivery_address: { line1, area, city, pincode,
//     latitude?, longitude? }, items: [{ product_id, quantity,
//     price_snapshot_inr }], delivery_date?, delivery_slot? }
//
// Response:
//   { ok, db_order_id, razorpay_order_id, amount (paise), currency,
//     subtotal_inr, delivery_fee_inr, total_amount_inr }

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone, isValidMobileAppKey } from "@/lib/phone-cookie";
import {
  DELIVERY_FEE_INR,
  reconcilePrices,
  toLocal10,
  validateOrderBodyShape,
  type ProductRow,
} from "@/lib/order-validation";
import {
  isAcceptableDeliveryDate,
  isAcceptableDeliverySlot,
} from "@/lib/order-delivery";
import { validateBookingSlot } from "@/lib/delivery-slots";
import { normalizePincode, resolveServiceability } from "@/lib/service-areas";
import { computeDeliveryFee } from "@/lib/deliveryFee";
import { getDrivingDistanceKm, hasActivePickups } from "@/lib/distanceMatrix";
import { geocodePincode } from "@/lib/geocode";
import { getPreorderMode } from "@/lib/preorderMode";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** Parses a value as a finite number, returning null for absent/invalid. */
function parseCoord(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: NextRequest) {
  // Fail closed if the friction key isn't configured.
  if (!process.env.MOBILE_APP_KEY) {
    return NextResponse.json(
      { ok: false, error: "Server misconfigured" },
      { status: 500 },
    );
  }

  // 0. Razorpay must be configured. Same keys as the web routes; secret
  //    stays server-side only. 503 (no `code`) → the app treats this as
  //    "online payment unavailable, use COD".
  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) {
    return NextResponse.json(
      { ok: false, error: "Razorpay not configured" },
      { status: 503 },
    );
  }

  // 1. App-key friction check.
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  // 2. Bearer-token auth.
  const verified = getVerifiedPhone(req);
  if (!verified) {
    return NextResponse.json(
      { ok: false, error: "Phone not verified" },
      { status: 401 },
    );
  }

  // 3. Strip +91 to match the 10-digit local format used in customers.phone.
  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) {
    return NextResponse.json(
      { ok: false, error: "Verified phone is not in expected format" },
      { status: 400 },
    );
  }

  // 4. Validate body shape.
  const raw = await req.json().catch(() => null);
  const shape = validateOrderBodyShape(raw);
  if (!shape.ok) {
    return NextResponse.json(
      { ok: false, error: shape.error, code: shape.code },
      { status: shape.status },
    );
  }
  const { body, fullName, addressString } = shape;

  // 4b. Pincode serviceability.
  const pincode = normalizePincode(body.delivery_address.pincode);
  if (!pincode) {
    return NextResponse.json(
      { ok: false, error: "Invalid pincode" },
      { status: 400 },
    );
  }
  const serviceability = await resolveServiceability(pincode);
  if (!serviceability.serviceable) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "We don't deliver to this pincode yet. Send us a request and we'll get in touch.",
        code: "pincode_unserviceable",
      },
      { status: 400 },
    );
  }
  const proximityHint =
    serviceability.via === "proximity" ? serviceability : null;

  // Site-wide pre-order mode. When ON, any date/slot the app sends is
  // dropped; the order row is stamped is_preorder=true. Mobile order
  // creation is ALLOWED during pre-order (unlike subscriptions).
  const preorderMode = await getPreorderMode();

  // 4c. Optional delivery date + slot (validated strictly when present).
  const rawObj = (raw ?? {}) as {
    delivery_date?: unknown;
    delivery_slot?: unknown;
  };
  let deliveryDate: string | null = null;
  let deliverySlot: string | null = null;
  if (!preorderMode && rawObj.delivery_date !== undefined && rawObj.delivery_date !== null) {
    if (
      typeof rawObj.delivery_date !== "string" ||
      !isAcceptableDeliveryDate(rawObj.delivery_date)
    ) {
      return NextResponse.json(
        { ok: false, error: "Invalid delivery_date" },
        { status: 400 },
      );
    }
    deliveryDate = rawObj.delivery_date;
  }
  if (!preorderMode && rawObj.delivery_slot !== undefined && rawObj.delivery_slot !== null) {
    if (
      typeof rawObj.delivery_slot !== "string" ||
      !isAcceptableDeliverySlot(rawObj.delivery_slot)
    ) {
      return NextResponse.json(
        { ok: false, error: "Invalid delivery_slot" },
        { status: 400 },
      );
    }
    deliverySlot = rawObj.delivery_slot;
  }
  if (deliveryDate && deliverySlot) {
    const gate = validateBookingSlot(deliveryDate, deliverySlot);
    if (gate) {
      return NextResponse.json(
        { ok: false, error: gate.error, code: gate.code },
        { status: gate.status },
      );
    }
  }

  // 5. Server-side price validation against authoritative product rows.
  const productIds = Array.from(new Set(body.items.map((i) => i.product_id)));
  const { data: productRows, error: productsErr } = await supabaseAdmin
    .from("products")
    .select("id, name, price_inr, is_active, is_archived, in_stock")
    .in("id", productIds);

  if (productsErr) {
    console.error("[mobile/create-order] products fetch failed:", productsErr);
    return NextResponse.json(
      { ok: false, error: "Failed to validate cart" },
      { status: 500 },
    );
  }

  const reconciled = reconcilePrices(
    body.items,
    (productRows ?? []) as ProductRow[],
  );
  if (!reconciled.ok) {
    return NextResponse.json(
      { ok: false, error: reconciled.error, code: reconciled.code },
      { status: reconciled.status },
    );
  }

  // 6. Customer upsert by phone.
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (lookupErr) {
    console.error("[mobile/create-order] customer lookup failed:", lookupErr);
    return NextResponse.json(
      { ok: false, error: "Failed to resolve customer" },
      { status: 500 },
    );
  }

  let customerId: string;
  if (existing) {
    const { error: updateErr } = await supabaseAdmin
      .from("customers")
      .update({ full_name: fullName, city: body.delivery_address.city })
      .eq("id", existing.id);
    if (updateErr) {
      console.error("[mobile/create-order] customer update failed:", updateErr);
      return NextResponse.json(
        { ok: false, error: "Failed to update customer" },
        { status: 500 },
      );
    }
    customerId = existing.id;
  } else {
    const { data: newCust, error: insertErr } = await supabaseAdmin
      .from("customers")
      .insert({
        full_name: fullName,
        phone: phoneLocal,
        city: body.delivery_address.city,
      })
      .select("id")
      .single();
    if (insertErr || !newCust) {
      console.error("[mobile/create-order] customer insert failed:", insertErr);
      return NextResponse.json(
        { ok: false, error: "Failed to create customer" },
        { status: 500 },
      );
    }
    customerId = newCust.id;
  }

  // 7. Server-authoritative distance-based delivery fee.
  const subtotal = reconciled.total;
  const rawAddr =
    (raw as { delivery_address?: Record<string, unknown> })?.delivery_address ??
    {};
  const orderLat = parseCoord(rawAddr.latitude);
  const orderLng = parseCoord(rawAddr.longitude);

  let deliveryFee = DELIVERY_FEE_INR;
  let distanceKm: number | null = null;

  if (await hasActivePickups()) {
    if (orderLat !== null && orderLng !== null) {
      distanceKm = await getDrivingDistanceKm(orderLat, orderLng);
    } else if (pincode) {
      const centroid = await geocodePincode(pincode);
      if (centroid) {
        distanceKm = await getDrivingDistanceKm(
          centroid.latitude,
          centroid.longitude,
        );
      }
    }
    if (distanceKm !== null) {
      const feeResult = computeDeliveryFee(distanceKm);
      if (!feeResult.serviceable) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "We don't deliver beyond 20 km yet. Please check our service area.",
            code: "distance_unserviceable",
          },
          { status: 400 },
        );
      }
      deliveryFee = feeResult.feeInr;
    }
  }

  const grandTotal = subtotal + deliveryFee;
  const amount = Math.round(grandTotal * 100); // paise, integer

  // 8. Create the Razorpay order for the server-confirmed total.
  const authHeader = Buffer.from(`${key}:${secret}`).toString("base64");
  const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authHeader}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount,
      currency: "INR",
      receipt: `cadieux_app_${Date.now()}`,
    }),
  });
  const rzp = (await rzpRes.json()) as {
    id?: string;
    amount?: number;
    currency?: string;
    error?: { description?: string };
  };
  if (!rzpRes.ok || !rzp.id) {
    console.error("[mobile/create-order] razorpay order failed:", rzp.error);
    return NextResponse.json(
      { ok: false, error: rzp.error?.description ?? "Razorpay error" },
      { status: 502 },
    );
  }

  // 9. Insert the pending order row up-front, tagged with the razorpay
  //    order id. Stays payment_status='created' until a verified
  //    signature in /api/mobile/verify-payment flips it to 'paid'.
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .insert({
      customer_id: customerId,
      total_amount: grandTotal,
      delivery_fee: deliveryFee,
      status: "pending",
      payment_method: "razorpay",
      payment_status: "created",
      razorpay_order_id: rzp.id,
      delivery_address: addressString,
      items: reconciled.items,
      delivery_date: deliveryDate,
      delivery_slot: deliverySlot,
      ...(orderLat !== null && orderLng !== null
        ? { latitude: orderLat, longitude: orderLng }
        : {}),
      ...(distanceKm !== null ? { distance_km: distanceKm } : {}),
      // Pre-order stamp: only when the site-wide toggle was ON at request
      // time. Normal orders leave the column untouched (default false).
      ...(preorderMode ? { is_preorder: true } : {}),
    })
    .select("id")
    .single();

  if (orderErr || !order) {
    console.error("[mobile/create-order] order insert failed:", orderErr);
    return NextResponse.json(
      { ok: false, error: "Failed to create order" },
      { status: 500 },
    );
  }

  // Proximity match → log an area suggestion (best-effort, non-blocking).
  if (proximityHint) {
    void supabaseAdmin
      .from("delivery_requests")
      .insert({
        customer_id: customerId,
        phone: phoneLocal,
        pincode,
        area_name: `Auto: near ${proximityHint.nearest_area} (${proximityHint.distance_km}km)`,
        address: addressString,
        status: "pending",
        source: "proximity_order",
      })
      .then(({ error: e }) => {
        if (e)
          console.warn(
            "[mobile/create-order] proximity suggestion failed:",
            e.message,
          );
      });
  }

  return NextResponse.json({
    ok: true,
    db_order_id: order.id,
    razorpay_order_id: rzp.id,
    amount: rzp.amount, // paise (server-confirmed)
    currency: rzp.currency,
    subtotal_inr: subtotal,
    delivery_fee_inr: deliveryFee,
    total_amount_inr: grandTotal,
  });
}
