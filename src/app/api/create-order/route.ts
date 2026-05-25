// POST /api/create-order
//
// Creates a Razorpay order for the online-payment flow.
// Previously trusted the client-supplied `amount` — now computes the
// delivery fee server-side from lat/lng (or pincode centroid) so the
// Razorpay capture amount is authoritative and never client-tampered.
//
// Request body:
//   { subtotal: number, lat?: number, lng?: number, pincode?: string }
//
// Response:
//   { order_id, amount (paise), currency, server_fee_inr }

import { NextRequest, NextResponse } from "next/server";

import { DELIVERY_FEE_INR } from "@/lib/order-validation";
import { computeDeliveryFee } from "@/lib/deliveryFee";
import { getDrivingDistanceKm, hasActivePickups } from "@/lib/distanceMatrix";
import { geocodePincode } from "@/lib/geocode";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    subtotal?: unknown;
    lat?: unknown;
    lng?: unknown;
    pincode?: unknown;
  };

  const key    = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) {
    return NextResponse.json(
      { error: "Razorpay not configured" },
      { status: 503 },
    );
  }

  const subtotal = Number(body.subtotal);
  if (!Number.isFinite(subtotal) || subtotal < 0) {
    return NextResponse.json({ error: "Invalid subtotal" }, { status: 400 });
  }

  // Server-compute delivery fee from coordinates or pincode.
  // Falls back to flat DELIVERY_FEE_INR when origin env vars are absent.
  let deliveryFee = DELIVERY_FEE_INR;
  let distanceKm: number | null = null;

  if (await hasActivePickups()) {
    const lat     = Number(body.lat);
    const lng     = Number(body.lng);
    const pincode = typeof body.pincode === "string"
      ? body.pincode.replace(/\D/g, "")
      : "";

    if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
      distanceKm = await getDrivingDistanceKm(lat, lng);
    } else if (/^\d{6}$/.test(pincode)) {
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
  const amount = Math.round(grandTotal * 100); // paise, integer

  const auth = Buffer.from(`${key}:${secret}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization:  `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount,
      currency: "INR",
      receipt:  `cadieux_${Date.now()}`,
    }),
  });

  const data = await res.json() as {
    id?: string;
    amount?: number;
    currency?: string;
    error?: { description?: string };
  };
  if (!res.ok) {
    return NextResponse.json(
      { error: data.error?.description ?? "Razorpay error" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    order_id:       data.id,
    amount:         data.amount,   // paise (server-confirmed)
    currency:       data.currency,
    server_fee_inr: deliveryFee,   // so client can display the confirmed fee
  });
}
