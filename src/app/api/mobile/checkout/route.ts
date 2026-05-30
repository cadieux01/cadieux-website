// /api/mobile/checkout
//
// Mobile-equivalent of website's /api/checkout (place_order action).
// Differences from web:
//  - Bearer token auth instead of cookie
//  - Server-side price validation against products table (web trusts client)
//  - Order items snapshot persisted to orders.items jsonb (web loses item info)
//  - No Razorpay flow (Phase 3d)
//
// Status starts as 'pending_payment'. Will transition to 'paid' in Phase 3d.
//
// MOBILE_APP_KEY is a friction layer, not a real secret. See phase 3b notes.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone, isValidMobileAppKey, maskPhone } from "@/lib/phone-cookie";
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
import { internalJsonHeaders } from "@/lib/internal-secret";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.cadieux.in";

/** Parses a value as a finite number, returning null for absent/invalid. */
function parseCoord(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: NextRequest) {
  // Fail closed if MOBILE_APP_KEY isn't configured.
  if (!process.env.MOBILE_APP_KEY) {
    return NextResponse.json(
      { ok: false, error: "Server misconfigured" },
      { status: 500 },
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

  // 4b. Pincode serviceability: refuse to place orders for pincodes we
  // don't currently deliver to. Mobile clients should funnel the user
  // into the same "send request" UX as web in this case.
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
        error: "We don't deliver to this pincode yet. Send us a request and we'll get in touch.",
        code: "pincode_unserviceable",
      },
      { status: 400 },
    );
  }
  // When auto-approved via proximity, we'll log an area suggestion
  // after the order insert succeeds (see below).
  const proximityHint =
    serviceability.via === "proximity" ? serviceability : null;

  // 4c. Optional delivery date + slot. The mobile app will start sending
  // these in a follow-up release; until then we accept null and store
  // null. When present we validate them strictly so a stale or malformed
  // value can't slip through.
  const rawObj = (raw ?? {}) as { delivery_date?: unknown; delivery_slot?: unknown };
  let deliveryDate: string | null = null;
  let deliverySlot: string | null = null;
  if (rawObj.delivery_date !== undefined && rawObj.delivery_date !== null) {
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
  if (rawObj.delivery_slot !== undefined && rawObj.delivery_slot !== null) {
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
  // 12 h 10 m booking lead — server-side source of truth. Applies only
  // when BOTH date and slot are provided (legacy app builds that omit
  // them still null-write — see comment block above). The mobile app
  // now always sends both.
  if (deliveryDate && deliverySlot) {
    const gate = validateBookingSlot(deliveryDate, deliverySlot);
    if (gate) {
      return NextResponse.json(
        { ok: false, error: gate.error, code: gate.code },
        { status: gate.status },
      );
    }
  }

  // 5. Server-side price validation. Re-fetch authoritative product rows.
  const productIds = Array.from(new Set(body.items.map((i) => i.product_id)));
  const { data: productRows, error: productsErr } = await supabaseAdmin
    .from("products")
    .select("id, name, price_inr, is_active, is_archived, in_stock")
    .in("id", productIds);

  if (productsErr) {
    console.error("[mobile/checkout] products fetch failed:", productsErr);
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
    console.error("[mobile/checkout] customer lookup failed:", lookupErr);
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
      console.error("[mobile/checkout] customer update failed:", updateErr);
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
      console.error("[mobile/checkout] customer insert failed:", insertErr);
      return NextResponse.json(
        { ok: false, error: "Failed to create customer" },
        { status: 500 },
      );
    }
    customerId = newCust.id;
  }

  // 7. Insert the order with the items snapshot + server-computed total.
  // Total stored in orders.total_amount is inclusive of the delivery fee.
  const subtotal = reconciled.total;

  // Extract GPS coordinates from the delivery_address object if the app sent them.
  const rawAddr = (raw as { delivery_address?: Record<string, unknown> })?.delivery_address ?? {};
  const orderLat = parseCoord(rawAddr.latitude);
  const orderLng = parseCoord(rawAddr.longitude);

  // Compute distance-based delivery fee (server-authoritative).
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
              "We don't deliver beyond 10 km yet. Please check our service area.",
            code: "distance_unserviceable",
          },
          { status: 400 },
        );
      }
      deliveryFee = feeResult.feeInr;
    }
  }

  const grandTotal = subtotal + deliveryFee;

  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .insert({
      customer_id: customerId,
      total_amount: grandTotal,
      delivery_fee: deliveryFee,
      status: "pending_payment",
      delivery_address: addressString,
      items: reconciled.items,
      // Mobile clients can now optionally pass delivery_date + slot in
      // the request body; absent fields stay null (legacy app builds)
      // and the operator can patch via PATCH /api/admin/orders/[id].
      delivery_date: deliveryDate,
      delivery_slot: deliverySlot,
      ...(orderLat !== null && orderLng !== null ? { latitude: orderLat, longitude: orderLng } : {}),
      ...(distanceKm !== null ? { distance_km: distanceKm } : {}),
    })
    .select("id")
    .single();

  if (orderErr || !order) {
    console.error("[mobile/checkout] order insert failed:", orderErr);
    return NextResponse.json(
      { ok: false, error: "Failed to create order" },
      { status: 500 },
    );
  }

  // Proximity match → log an area suggestion so admin can promote it
  // to a formal Areas We Serve entry. Best-effort.
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
        if (e) console.warn("[mobile/checkout] proximity suggestion failed:", e.message);
      });
  }

  // 8. Fire-and-forget SMS + WhatsApp (mirror website's CheckoutModal calls).
  //    We don't await these — they must not block or fail the order response.
  fireAndForget(
    fetch(`${SITE_URL}/api/send-sms`, {
      method: "POST",
      headers: internalJsonHeaders(),
      body: JSON.stringify({
        type: "order_placed",
        phone: phoneLocal,
        name: fullName,
        orderId: order.id,
        total: grandTotal,
        address: addressString,
      }),
    }),
    "send-sms",
    { phone: phoneLocal },
  );

  const shortId = String(order.id).slice(0, 8).toUpperCase();
  const waMessage =
    `Hi ${fullName || "there"}! 🍞 Your Cadieux order has been placed successfully!\n\n` +
    `Order ID: ${shortId}\n` +
    `Total: ₹${grandTotal}\n` +
    `Delivery to: ${addressString}\n\n` +
    `We will confirm your order shortly. Thank you for choosing Cadieux!`;
  fireAndForget(
    fetch(`${SITE_URL}/api/send-whatsapp`, {
      method: "POST",
      headers: internalJsonHeaders(),
      body: JSON.stringify({ phone: phoneLocal, message: waMessage }),
    }),
    "send-whatsapp",
    { phone: phoneLocal },
  );

  return NextResponse.json({
    ok: true,
    order_id: order.id,
    subtotal_inr: subtotal,
    delivery_fee_inr: deliveryFee,
    total_amount_inr: grandTotal,
    items_summary: reconciled.itemsSummary,
  });
}

/**
 * Detaches a fetch from the response lifecycle. Logs both network failures
 * AND non-2xx responses — Twilio errors come back as 4xx/5xx, which
 * `fetch` does NOT throw on, so the previous .catch-only path silently
 * dropped real delivery failures. Phone is masked to the last 4 digits.
 */
function fireAndForget(
  p: Promise<Response>,
  label: string,
  ctx: { phone: string },
): void {
  p.then(async (res) => {
    if (!res.ok) {
      // Pull only safe fields. Don't log the full response — Twilio echoes
      // back the recipient phone and the message body, both sensitive.
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string | number;
      };
      console.error(
        `[mobile/checkout] ${label} http_failed`,
        {
          status: res.status,
          code: data.code,
          error: data.error,
          phone: maskPhone(ctx.phone),
        },
      );
    }
  }).catch((err) => {
    console.error(
      `[mobile/checkout] ${label} threw`,
      { phone: maskPhone(ctx.phone), err: String(err) },
    );
  });
}
