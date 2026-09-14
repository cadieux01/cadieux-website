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
import { getPreorderMode } from "@/lib/preorderMode";
import { queueBurstAlert } from "@/lib/order-burst-alert";
import {
  normalizePhone,
  signPhoneCookie,
  PHONE_COOKIE_NAME,
  PHONE_COOKIE_TTL_MS,
} from "@/lib/phone-cookie";
import {
  allowedOrFailOpen,
  getClientIP,
  ORDER_PHONE_LIMIT_MESSAGE,
  orderPhoneRateLimit,
  orderRateLimit,
} from "@/lib/ratelimit";

// Server-only admin client (service role, bypasses RLS).
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Per-IP cap. This route had none, and 29 of the 34 orders the 13 Sep probe
  // created came through it rather than the COD path.
  const ipUnderLimit = await allowedOrFailOpen(
    orderRateLimit,
    `create-order:${getClientIP(req)}`,
  );
  if (!ipUnderLimit) {
    return NextResponse.json(
      {
        error: "Too many attempts. Please wait a few minutes and try again.",
        code: "rate_limited",
      },
      { status: 429 },
    );
  }

  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) {
    return NextResponse.json(
      { error: "Razorpay not configured" },
      { status: 503 },
    );
  }

  // Identical validation + authoritative pricing as the COD path.
  // Pre-order mode is read fresh every request so a flip in the admin
  // toggle takes effect immediately without invalidating any cache.
  const preorderMode = await getPreorderMode();
  const prep = await prepareOneTimeOrder(body, req, supabaseAdmin, {
    preorderMode,
  });
  if (!prep.ok) {
    return NextResponse.json(prep.body, { status: prep.status });
  }
  const prepared = prep.data;

  // Per-phone cap, checked after prepare (read-only) and before we create
  // anything at Razorpay or in the orders table. Shares the `order:` key with
  // the COD path so the two together get one 3/30min budget, not two.
  const phoneUnderLimit = await allowedOrFailOpen(
    orderPhoneRateLimit,
    `order:${normalizePhone(prepared.custPhone ?? "unknown")}`,
  );
  if (!phoneUnderLimit) {
    return NextResponse.json(
      {
        error: ORDER_PHONE_LIMIT_MESSAGE,
        code: "rate_limited",
      },
      { status: 429 },
    );
  }

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
    .select("id, order_number, public_ref")
    .single();

  if (error) {
    console.error("❌ Razorpay order row insert failed:", error);
    return NextResponse.json(
      { error: "Failed to create order", details: error.message },
      { status: 500 },
    );
  }

  logProximitySuggestion(supabaseAdmin, prepared);

  // Burst check on the committed row. This path is the one that matters most:
  // 29 of the 34 orders the 13 Sep probe created came through it. Never
  // awaited; see lib/order-burst-alert.ts.
  queueBurstAlert(prepared.custPhone);

  const res = NextResponse.json({
    db_order_id: order.id,
    // The customer-facing order number. Consumed by the client to route
    // the correct label into SMS + WhatsApp. This is the OLF number as of
    // 2026-09-14 — see lib/order-number.ts for why it is now in a browser
    // response, and for what that discloses.
    order_number: order.order_number,
    // Legacy CX- reference, retained but no longer displayed.
    public_ref: order.public_ref,
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
