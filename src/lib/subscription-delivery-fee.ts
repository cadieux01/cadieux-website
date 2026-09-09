// Subscription delivery fee + total, server-authoritative.
//
// Subscriptions used to ship every delivery free and were never distance
// gated at all — which is how a live subscription to pincode 769008
// (Rourkela, Odisha, ~700 km away) got accepted. This module closes both
// holes for all three creation paths (website checkout, mobile, admin).
//
// The fee itself comes from the SHARED `computeDeliveryFee` in
// @/lib/deliveryFee — the exact same flat fee one-time orders pay.
// There is deliberately no second fee calculation anywhere in here.
//
// DIFFERENCE FROM ONE-TIME ORDERS — deliberate, do not "fix":
// a one-time order falls back to DELIVERY_FEE_INR when the distance can't
// be resolved, because it still has to charge something. A subscription
// multiplies the fee by the delivery count and charges it UP FRONT, so
// falling back would bill N deliveries on a guess — and, worse, would let
// an out-of-area address through unpriced. We block instead and ask the
// customer for a location. Never add a fallback fee here.
//
// Distance input is the pincode centroid only. The wizards don't collect
// GPS today; subscriptions.latitude/longitude exist so it can be threaded
// in later without another migration.

import { computeDeliveryFee, MAX_DELIVERY_KM } from "@/lib/deliveryFee";
import { geocodePincode } from "@/lib/geocode";
import { getDrivingDistanceKm, hasActivePickups } from "@/lib/distanceMatrix";

/** Why a subscription could not be priced. Both are hard blocks. */
export type SubscriptionFeeErrorCode =
  | "location_required"
  | "distance_unserviceable";

// The range in the copy is interpolated from MAX_DELIVERY_KM rather than
// typed out, so re-pricing deliveryFee.ts can never leave the customer
// reading a number we no longer honour.
export const SUBSCRIPTION_FEE_ERRORS: Record<
  SubscriptionFeeErrorCode,
  string
> = {
  location_required:
    "We couldn't work out your delivery distance from that pincode. Please check the pincode, or contact us and we'll set this up for you.",
  distance_unserviceable:
    `We don't deliver beyond ${MAX_DELIVERY_KM} km yet, so we can't start a subscription to this address. Please check our service area.`,
};

export type SubscriptionFeeQuote =
  | { ok: true; feeInr: number; distanceKm: number }
  | {
      ok: false;
      status: number;
      error: string;
      code: SubscriptionFeeErrorCode;
    };

function block(code: SubscriptionFeeErrorCode): SubscriptionFeeQuote {
  return {
    ok: false,
    status: 400,
    error: SUBSCRIPTION_FEE_ERRORS[code],
    code,
  };
}

/**
 * Resolve the PER-DELIVERY delivery fee for a subscription from its pincode.
 *
 * Blocks (never guesses) when:
 *   • the pincode is missing or not 6 digits
 *   • no active pickup locations are configured
 *   • the pincode can't be geocoded
 *   • the driving distance can't be resolved
 *   • the address is out of range (computeDeliveryFee → serviceable:false).
 *     The cutoff is whatever the shared helper says (MAX_DELIVERY_KM),
 *     so subscriptions and one-time orders gate at the exact same distance.
 */
export async function quoteSubscriptionDeliveryFee(
  pincode: string | null | undefined,
): Promise<SubscriptionFeeQuote> {
  const pin = typeof pincode === "string" ? pincode.trim() : "";
  if (!/^\d{6}$/.test(pin)) return block("location_required");

  // No pickups configured means there is no origin to measure from. A
  // one-time order would quietly fall back to DELIVERY_FEE_INR; a
  // subscription must not.
  if (!(await hasActivePickups())) {
    console.error(
      "[subscription-fee] no active pickup_locations — cannot price a subscription",
    );
    return block("location_required");
  }

  const centroid = await geocodePincode(pin);
  if (!centroid) return block("location_required");

  const distanceKm = await getDrivingDistanceKm(
    centroid.latitude,
    centroid.longitude,
  );
  if (distanceKm === null || !Number.isFinite(distanceKm)) {
    return block("location_required");
  }

  const { serviceable, feeInr } = computeDeliveryFee(distanceKm);
  if (!serviceable) return block("distance_unserviceable");

  return { ok: true, feeInr, distanceKm };
}

// ── Pure total math ─────────────────────────────────────────────────
// Re-exported from @/lib/subscription-total so server callers can pull the
// quote and the math from one place. Client components must import from
// subscription-total directly — see the note at the top of that file.
export {
  computeSubscriptionTotal,
  toPaise,
  type SubscriptionTotal,
} from "@/lib/subscription-total";
