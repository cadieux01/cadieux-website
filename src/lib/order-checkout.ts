// Shared server-side validation + pricing for one-time (non-subscription)
// orders. Used by BOTH:
//   • POST /api/checkout       action "place_order"  (Cash on Delivery)
//   • POST /api/create-order   (Razorpay online payment)
//
// Centralising this means the Razorpay capture amount and the COD order
// total are derived from the EXACT same authoritative logic — prices come
// from the products table, the delivery fee is computed server-side, and
// the client-supplied total is only ever compared, never trusted.

import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getVerifiedPhone, normalizePhone } from "@/lib/phone-cookie";
import {
  DELIVERY_FEE_INR,
  reconcileWebPrices,
  validateWebOrderItemsShape,
  type WebProductRow,
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

/** Parses a value as a finite number, returning null for absent/invalid. */
function parseCoord(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type ProximityHint = {
  nearest_area?: string;
  distance_km?: number;
} | null;

export type PreparedOrder = {
  customerId: string;
  custPhone: string | null;
  deliveryAddress: string;
  pincode: string;
  deliveryDate: string;
  deliverySlot: string;
  items: unknown;
  subtotal: number;
  deliveryFee: number;
  grandTotal: number;
  orderLat: number | null;
  orderLng: number | null;
  distanceKm: number | null;
  proximityHint: ProximityHint;
};

export type PrepareResult =
  | { ok: true; data: PreparedOrder }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Runs every server-side gate a one-time order must pass and returns the
 * authoritative, reconciled order figures. Returns a structured error (to
 * be turned into a NextResponse by the caller) on the first failed gate.
 *
 * Does NOT insert anything — the caller decides whether to create a COD
 * order row or a Razorpay order + pending row.
 */
export async function prepareOneTimeOrder(
  body: Record<string, unknown>,
  req: NextRequest,
  supabaseAdmin: SupabaseClient,
): Promise<PrepareResult> {
  const customer_id = body.customer_id as string | undefined;
  const delivery_address = body.delivery_address as string | undefined;
  const total_amount = body.total_amount;

  if (!delivery_address || total_amount === undefined || total_amount === null) {
    return { ok: false, status: 400, body: { error: "Missing fields" } };
  }

  const deliveryDate =
    typeof body.delivery_date === "string" ? body.delivery_date : "";
  const deliverySlot =
    typeof body.delivery_slot === "string" ? body.delivery_slot : "";
  if (!isAcceptableDeliveryDate(deliveryDate)) {
    return {
      ok: false,
      status: 400,
      body: { error: "Please pick a delivery date with at least one bookable slot." },
    };
  }
  if (!isAcceptableDeliverySlot(deliverySlot)) {
    return {
      ok: false,
      status: 400,
      body: { error: "Please pick a delivery time slot." },
    };
  }
  const slotGate = validateBookingSlot(deliveryDate, deliverySlot);
  if (slotGate) {
    return { ok: false, status: slotGate.status, body: { error: slotGate.error, code: slotGate.code } };
  }

  // Re-check serviceability server-side. The client gates the CTA but a
  // determined attacker could submit anyway.
  const pinFromAddress =
    typeof body.pincode === "string"
      ? normalizePincode(body.pincode)
      : (delivery_address.match(/(\d{6})\s*$/)?.[1] ?? null);
  if (!pinFromAddress) {
    return { ok: false, status: 400, body: { error: "Invalid pincode." } };
  }
  const serviceability = await resolveServiceability(pinFromAddress);
  if (!serviceability.serviceable) {
    return {
      ok: false,
      status: 400,
      body: {
        error:
          "We don't deliver to this pincode yet. Send us a request and we'll get in touch.",
        code: "pincode_unserviceable",
      },
    };
  }
  const proximityHint: ProximityHint =
    serviceability.via === "proximity" ? (serviceability as ProximityHint) : null;

  const verified = getVerifiedPhone(req);

  if (!customer_id) {
    return { ok: false, status: 400, body: { error: "Missing customer." } };
  }

  // Validate items shape, then re-derive prices from the products table.
  const itemsShape = validateWebOrderItemsShape(body.items);
  if (!itemsShape.ok) {
    return { ok: false, status: itemsShape.status, body: { error: itemsShape.error, code: itemsShape.code } };
  }

  const slugs = Array.from(new Set(itemsShape.items.map((i) => i.slug)));
  const { data: productRows, error: productsErr } = await supabaseAdmin
    .from("products")
    .select("slug, name, price_inr, is_active, is_archived, in_stock")
    .in("slug", slugs);
  if (productsErr) {
    console.error("[checkout] products fetch failed:", productsErr);
    return { ok: false, status: 500, body: { error: "Failed to validate cart" } };
  }

  const reconciled = reconcileWebPrices(
    itemsShape.items,
    (productRows ?? []) as WebProductRow[],
  );
  if (!reconciled.ok) {
    return { ok: false, status: reconciled.status, body: { error: reconciled.error, code: reconciled.code } };
  }

  // Compare the client's idea of the subtotal — never trust it.
  const clientSubtotal = Number(total_amount);
  if (!Number.isFinite(clientSubtotal) || clientSubtotal !== reconciled.subtotal) {
    return {
      ok: false,
      status: 400,
      body: { error: "Price mismatch — please refresh and retry", code: "price_mismatch" },
    };
  }

  // Server-authoritative distance-based delivery fee.
  const orderLat = parseCoord(body.latitude);
  const orderLng = parseCoord(body.longitude);
  let deliveryFee = DELIVERY_FEE_INR;
  let distanceKm: number | null = null;

  if (await hasActivePickups()) {
    if (orderLat !== null && orderLng !== null) {
      distanceKm = await getDrivingDistanceKm(orderLat, orderLng);
    } else if (pinFromAddress) {
      const centroid = await geocodePincode(pinFromAddress);
      if (centroid) {
        distanceKm = await getDrivingDistanceKm(centroid.latitude, centroid.longitude);
      }
    }
    if (distanceKm !== null) {
      const feeResult = computeDeliveryFee(distanceKm);
      if (!feeResult.serviceable) {
        return {
          ok: false,
          status: 400,
          body: {
            error: "We don't deliver beyond 10 km yet. Please check our service area.",
            code: "distance_unserviceable",
          },
        };
      }
      deliveryFee = feeResult.feeInr;
    }
  }

  const grandTotal = reconciled.subtotal + deliveryFee;

  // Phone-verification gate: a saved customer record proves past OTP
  // verification; a valid cookie must match that record's phone.
  const { data: cust } = await supabaseAdmin
    .from("customers")
    .select("id, phone")
    .eq("id", customer_id)
    .maybeSingle();
  if (!cust) {
    return { ok: false, status: 401, body: { error: "Phone verification required." } };
  }
  const effectiveVerifiedPhone = verified?.phone ?? normalizePhone(cust.phone);
  if (normalizePhone(cust.phone) !== effectiveVerifiedPhone) {
    console.warn("⚠️  place_order phone mismatch", {
      customer_id,
      cust_phone: cust?.phone,
      verified_phone: verified?.phone,
    });
    return { ok: false, status: 401, body: { error: "Phone verification mismatch." } };
  }

  return {
    ok: true,
    data: {
      customerId: customer_id,
      custPhone: cust.phone ?? null,
      deliveryAddress: delivery_address,
      pincode: pinFromAddress,
      deliveryDate,
      deliverySlot,
      items: reconciled.items,
      subtotal: reconciled.subtotal,
      deliveryFee,
      grandTotal,
      orderLat,
      orderLng,
      distanceKm,
      proximityHint,
    },
  };
}

/**
 * Best-effort: when a pincode was auto-approved via proximity (not an exact
 * match), drop an "area suggestion" into delivery_requests so admin can
 * promote it. Never throws / never blocks the order.
 */
export function logProximitySuggestion(
  supabaseAdmin: SupabaseClient,
  prepared: PreparedOrder,
): void {
  if (!prepared.proximityHint) return;
  const last10 = prepared.custPhone
    ? (normalizePhone(prepared.custPhone)?.replace(/\D/g, "").slice(-10) ?? "")
    : "";
  void supabaseAdmin
    .from("delivery_requests")
    .insert({
      customer_id: prepared.customerId,
      phone: last10,
      pincode: prepared.pincode,
      area_name: `Auto: near ${prepared.proximityHint.nearest_area} (${prepared.proximityHint.distance_km}km)`,
      address: prepared.deliveryAddress,
      status: "pending",
      source: "proximity_order",
    })
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.warn("[checkout] proximity suggestion failed:", error.message);
    });
}

/** Common order-row columns for an insert, shared by COD + Razorpay paths. */
export function orderInsertColumns(prepared: PreparedOrder) {
  return {
    customer_id: prepared.customerId,
    total_amount: prepared.grandTotal,
    delivery_fee: prepared.deliveryFee,
    delivery_address: prepared.deliveryAddress,
    items: prepared.items,
    delivery_date: prepared.deliveryDate,
    delivery_slot: prepared.deliverySlot,
    ...(prepared.orderLat !== null && prepared.orderLng !== null
      ? { latitude: prepared.orderLat, longitude: prepared.orderLng }
      : {}),
    ...(prepared.distanceKm !== null ? { distance_km: prepared.distanceKm } : {}),
  };
}
