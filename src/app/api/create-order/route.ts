// POST /api/create-order
//
// Online-payment (Razorpay) counterpart to /api/checkout `place_order`.
//
// Runs the SAME server-side validation + pricing as the COD path
// (prepareOneTimeOrder), then:
//   1. creates a Razorpay order for the server-authoritative grand total,
//   2. inserts a `pending` orders row up-front with payment_status='created'
//      and the razorpay_order_id, so both /api/verify-payment AND the
//      /api/razorpay-webhook backup have a concrete row to reconcile against.
//
// The order is NEVER marked paid here — that only happens after a verified
// signature in /api/verify-payment (or the webhook). The amount sent to
// Razorpay is derived on the server; the client cannot influence it.
//
// Request body: the full order payload (same shape as place_order):
//   { customer_id, delivery_address, total_amount (client subtotal, compared
//     not trusted), pincode?, latitude?, longitude?, delivery_date,
//     delivery_slot, items }
//
// Response:
//   { db_order_id, razorpay_order_id, amount (paise), currency, server_fee_inr }

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import {
  prepareOneTimeOrder,
  orderInsertColumns,
  logProximitySuggestion,
} from "@/lib/order-checkout";
import {
  normalizePhone,
  signPhoneCookie,
  PHONE_COOKIE_NAME,
  PHONE_COOKIE_TTL_MS,
} from "@/lib/phone-cookie";

// Server-only admin client (service role, bypasses RLS).
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) {
    return NextResponse.json(
      { error: "Razorpay not configured" },
      { status: 503 },
    );
  }

  // Identical validation + authoritative pricing as the COD path.
  const prep = await prepareOneTimeOrder(body, req, supabaseAdmin);
  if (!prep.ok) {
    return NextResponse.json(prep.body, { status: prep.status });
  }
  const prepared = prep.data;

  const amount = Math.round(prepared.grandTotal * 100); // paise, integer

  // 1. Create the Razorpay order for the server-confirmed total.
  const auth = Buffer.from(`${key}:${secret}`).toString("base64");
  const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount,
      currency: "INR",
      receipt: `cadieux_${Date.now()}`,
    }),
  });

  const rzp = (await rzpRes.json()) as {
    id?: string;
    amount?: number;
    currency?: string;
    error?: { description?: string };
  };
  if (!rzpRes.ok || !rzp.id) {
    return NextResponse.json(
      { error: rzp.error?.description ?? "Razorpay error" },
      { status: 500 },
    );
  }

  // 2. Insert the pending order row up-front, tagged with the razorpay
  //    order id. Stays `pending` / payment_status='created' until a
  //    verified signature flips it to 'paid'.
  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .insert({
      ...orderInsertColumns(prepared),
      status: "pending",
      payment_method: "razorpay",
      payment_status: "created",
      razorpay_order_id: rzp.id,
    })
    .select("id, order_number")
    .single();

  if (error) {
    console.error("❌ Razorpay order row insert failed:", error);
    return NextResponse.json(
      { error: "Failed to create order", details: error.message },
      { status: 500 },
    );
  }

  logProximitySuggestion(supabaseAdmin, prepared);

  const res = NextResponse.json({
    db_order_id: order.id,
    // Human-facing OLF number (assigned by DB trigger). Consumed by the
    // client to route the correct label into SMS + WhatsApp.
    db_order_number: order.order_number,
    razorpay_order_id: rzp.id,
    amount: rzp.amount, // paise (server-confirmed)
    currency: rzp.currency,
    server_fee_inr: prepared.deliveryFee,
  });
  // Re-issue the verified-phone cookie so that after the Razorpay modal
  // succeeds and the client redirects to /orders/<id>, the tracking page's
  // strict read gate sees a valid cookie instead of 401 ("Verify your
  // phone"). Returning customers skip OTP (no cookie) and the 30-min cookie
  // can lapse during the online flow. The order was just created for this
  // customer; stamping the cookie for their own phone matches verify/check.
  if (prepared.custPhone) {
    const exp = Date.now() + PHONE_COOKIE_TTL_MS;
    res.cookies.set(
      PHONE_COOKIE_NAME,
      signPhoneCookie(normalizePhone(prepared.custPhone), exp),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: Math.floor(PHONE_COOKIE_TTL_MS / 1000),
      },
    );
  }
  return res;
}
