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
  /** 'delivery' (default) | 'pickup'. Pickup orders skip serviceability +
   *  distance-fee + date/slot gates entirely; the delivery path is byte-for-
   *  byte unchanged. Dormant until the Step 2 checkout UI starts sending
   *  fulfillment_type='pickup'. */
  fulfillmentType: "delivery" | "pickup";
  pickupLocationId: string | null;
  /** True when the site-wide pre-order mode was ON at the moment this
   *  order was prepared. Order row gets stamped is_preorder=true; admin
   *  sets the real delivery_date later. */
  isPreorder: boolean;
};

export type PrepareResult =
  | { ok: true; data: PreparedOrder }
  | { ok: false; status: number; body: Record<string, unknown> };

/** Options for admin-only overrides. Public callers pass nothing / undefined
 *  and get the exact same behaviour they always had. Only the admin manual-
 *  entry endpoint (POST /api/admin/orders) sets `skipServiceability`, and
 *  it only bypasses the pincode + >20km gates — every other gate (price,
 *  date, slot, item shape, phone-verification) is unchanged. */
export type PrepareOptions = {
  /** When true, skip BOTH the `pincode_unserviceable` and
   *  `distance_unserviceable` rejections. The fee is still computed from
   *  the real driving distance when it falls within the fee table; when
   *  the address is beyond the 20 km table, the formula is linearly
   *  extrapolated (₹92 + (km − 10) × ₹12) so the fee still scales with
   *  distance. Admin-only. */
  skipServiceability?: boolean;
  /** When true, the site-wide pre-order mode is ON. Skip the
   *  delivery-date + slot gates (both are optional — customers can't pick
   *  a real one yet), stamp the prepared order with is_preorder=true, and
   *  let the caller flip it into `orderInsertColumns`. Every other gate
   *  (serviceability, price, phone, item-shape) still runs. */
  preorderMode?: boolean;
};

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
  opts: PrepareOptions = {},
): Promise<PrepareResult> {
  const customer_id = body.customer_id as string | undefined;
  const total_amount = body.total_amount;

  // Fulfillment routing. Default to 'delivery' so pre-Step-2 clients (which
  // don't send this field yet) hit the exact same code path they always have.
  const rawFulfillment =
    typeof body.fulfillment_type === "string"
      ? body.fulfillment_type.toLowerCase()
      : "delivery";
  const fulfillmentType: "delivery" | "pickup" =
    rawFulfillment === "pickup" ? "pickup" : "delivery";
  const isPickup = fulfillmentType === "pickup";

  // Common preflight — required for both flows.
  if (total_amount === undefined || total_amount === null) {
    return { ok: false, status: 400, body: { error: "Missing fields" } };
  }
  if (!customer_id) {
    return { ok: false, status: 400, body: { error: "Missing customer." } };
  }

  // Pickup-flow gates. Delivery-flow gates (address, date/slot, serviceability,
  // distance fee) are the current code path — kept below untouched.
  let pickupLocationId: string | null = null;
  let pickupAddress = "";
  let pickupPincode = "";

  if (isPickup) {
    const raw =
      typeof body.pickup_location_id === "string"
        ? body.pickup_location_id.trim()
        : "";
    if (!raw) {
      return {
        ok: false,
        status: 400,
        body: { error: "Please choose a pickup point.", code: "pickup_location_required" },
      };
    }
    const { data: loc, error: locErr } = await supabaseAdmin
      .from("pickup_locations")
      .select("id, name, area, address, pincode, is_archived")
      .eq("id", raw)
      .maybeSingle();
    if (locErr || !loc || loc.is_archived) {
      return {
        ok: false,
        status: 400,
        body: {
          error: "That pickup point is no longer available. Please choose another.",
          code: "pickup_location_invalid",
        },
      };
    }
    pickupLocationId = loc.id;
    pickupAddress = `Pick up at ${loc.name}, ${loc.area}`;
    pickupPincode =
      typeof loc.pincode === "string" && /^\d{6}$/.test(loc.pincode)
        ? loc.pincode
        : (String(loc.address ?? "").match(/(\d{6})/)?.[1] ?? "");
  }

  const delivery_address = isPickup
    ? pickupAddress
    : (body.delivery_address as string | undefined);

  if (!isPickup && !delivery_address) {
    return { ok: false, status: 400, body: { error: "Missing fields" } };
  }

  // Delivery date/slot are optional on pickup (the stall hands over during
  // its open hours). We still accept + persist them for pickup if the client
  // sends them, but never gate on them.
  const deliveryDate =
    typeof body.delivery_date === "string" ? body.delivery_date : "";
  const deliverySlot =
    typeof body.delivery_slot === "string" ? body.delivery_slot : "";

  // In pre-order mode, customers cannot pick a real delivery date/slot yet
  // (admin will schedule it after the launch). Skip the date/slot gates
  // entirely; delivery_date + delivery_slot are left NULL on the order row
  // and stamped later by the admin PATCH.
  if (!isPickup && !opts.preorderMode) {
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
  }

  // Serviceability — delivery only. Pickup uses the stall's location.
  let pinFromAddress: string | null = null;
  let proximityHint: ProximityHint = null;

  if (isPickup) {
    pinFromAddress = pickupPincode || "";
  } else {
    pinFromAddress =
      typeof body.pincode === "string"
        ? normalizePincode(body.pincode)
        : (delivery_address!.match(/(\d{6})\s*$/)?.[1] ?? null);
    if (!pinFromAddress) {
      return { ok: false, status: 400, body: { error: "Invalid pincode." } };
    }
    const serviceability = await resolveServiceability(pinFromAddress);
    if (!serviceability.serviceable && !opts.skipServiceability) {
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
    proximityHint =
      serviceability.serviceable && serviceability.via === "proximity"
        ? (serviceability as ProximityHint)
        : null;
  }

  const verified = getVerifiedPhone(req);

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

  // Server-authoritative distance-based delivery fee. Pickup orders never
  // pay a delivery fee — the customer is coming to the stall.
  const orderLat = isPickup ? null : parseCoord(body.latitude);
  const orderLng = isPickup ? null : parseCoord(body.longitude);
  let deliveryFee = isPickup ? 0 : DELIVERY_FEE_INR;
  let distanceKm: number | null = null;

  if (!isPickup && (await hasActivePickups())) {
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
        if (!opts.skipServiceability) {
          return {
            ok: false,
            status: 400,
            body: {
              error: "We don't deliver beyond 20 km yet. Please check our service area.",
              code: "distance_unserviceable",
            },
          };
        }
        // Admin override: extrapolate the same ₹12/km slope used inside
        // the 10–20 km band so the fee still scales with distance.
        const c = Math.ceil(distanceKm);
        deliveryFee = 92 + (c - 10) * 12;
      } else {
        deliveryFee = feeResult.feeInr;
      }
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
      deliveryAddress: delivery_address!,
      pincode: pinFromAddress ?? "",
      // In pre-order mode we deliberately drop whatever the client sent for
      // date/slot — even if the client hasn't been updated yet — so the row
      // hits the DB with NULLs and admin becomes the authoritative source.
      deliveryDate: opts.preorderMode ? "" : deliveryDate,
      deliverySlot: opts.preorderMode ? "" : deliverySlot,
      items: reconciled.items,
      subtotal: reconciled.subtotal,
      deliveryFee,
      grandTotal,
      orderLat,
      orderLng,
      distanceKm,
      proximityHint,
      fulfillmentType,
      pickupLocationId,
      isPreorder: !!opts.preorderMode,
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
  const isPickup = prepared.fulfillmentType === "pickup";
  return {
    customer_id: prepared.customerId,
    total_amount: prepared.grandTotal,
    delivery_fee: prepared.deliveryFee,
    delivery_address: prepared.deliveryAddress,
    items: prepared.items,
    // Pickup orders don't have a delivery-slot commitment yet — persist the
    // fields only when the client actually chose them. Delivery orders are
    // gated above so these are always present.
    ...(prepared.deliveryDate ? { delivery_date: prepared.deliveryDate } : {}),
    ...(prepared.deliverySlot ? { delivery_slot: prepared.deliverySlot } : {}),
    ...(prepared.orderLat !== null && prepared.orderLng !== null
      ? { latitude: prepared.orderLat, longitude: prepared.orderLng }
      : {}),
    ...(prepared.distanceKm !== null ? { distance_km: prepared.distanceKm } : {}),
    // Fulfillment routing. Always write fulfillment_type; only include the
    // pickup_location_id when the flow is actually pickup.
    fulfillment_type: prepared.fulfillmentType,
    ...(isPickup && prepared.pickupLocationId
      ? { pickup_location_id: prepared.pickupLocationId }
      : {}),
    // Pre-order stamp: only written when true, so normal orders leave the
    // column untouched (defaulted to false server-side).
    ...(prepared.isPreorder ? { is_preorder: true } : {}),
  };
}
