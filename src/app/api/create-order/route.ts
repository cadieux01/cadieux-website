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
// PICKUP IS REFUSED HERE (code `pickup_pay_at_counter`), via the same
// isPayableOnline predicate the Pay Now button uses. This is the only place in
// the online-payment path where a pickup order can be refused without orphaning
// money — see the note at the check itself.
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
import { isPayableOnline } from "@/lib/order-payable";
import { getPreorderMode } from "@/lib/preorderMode";
import {
  hasSandwichItems,
  SANDWICH_CHECKOUT_BLOCK_CODE,
  SANDWICH_CHECKOUT_BLOCK_MESSAGE,
} from "@/lib/sandwich-checkout-guard";
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

  // TEMPORARY SCAFFOLDING (SANDWICH_CHECKOUT_BLOCK_CODE) — remove with the
  // OLF/OLW cart-split. Refused BEFORE any rate-limit spend or Razorpay
  // create call: this request would only fail loudly downstream, and letting
  // it consume the per-phone budget on the way in is worse than refusing
  // here. Mirror of the check in /api/checkout `place_order`.
  if (hasSandwichItems(body?.items)) {
    return NextResponse.json(
      { error: SANDWICH_CHECKOUT_BLOCK_MESSAGE, code: SANDWICH_CHECKOUT_BLOCK_CODE },
      { status: 400 },
    );
  }

  // Per-IP cap. This route had none, and 29 of the 34 orders the 13 Sep probe
  // created came through it rather than the COD path.
  //
  // Started alongside the pre-order-mode read rather than awaited before it.
  // Both are prerequisites of `prepareOneTimeOrder` and neither depends on the
  // other, so running them in series added one Upstash round trip to the
  // customer's wait for no reason. Overlapping is only safe because
  // getPreorderMode reads one global config value and writes nothing — no
  // per-customer work happens before the cap is honoured two lines below.
  const ipLimitCheck = allowedOrFailOpen(
    orderRateLimit,
    `create-order:${getClientIP(req)}`,
  );
  const preorderModeRead = getPreorderMode();
  // Attach a handler now, not at the await: every early return below leaves
  // this promise untouched, and an untouched rejected promise is an unhandled
  // rejection. The value is still read from the original promise.
  void preorderModeRead.catch(() => {});

  const ipUnderLimit = await ipLimitCheck;
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

  // Identical validation + authoritative pricing as the COD path. The
  // pre-order read was started above and has almost certainly resolved by now.
  const preorderMode = await preorderModeRead;
  const prep = await prepareOneTimeOrder(body, req, supabaseAdmin, {
    preorderMode,
  });
  if (!prep.ok) {
    return NextResponse.json(prep.body, { status: prep.status });
  }
  const prepared = prep.data;

  // PICKUP IS PAID AT THE COUNTER, AND THIS IS WHERE THAT IS ENFORCED.
  //
  // Checkout hides the Pay Online button on pickup, but a hidden button is not
  // a rule: this route accepts a `fulfillment_type: 'pickup'` payload and
  // prices it perfectly well, so without this a crafted POST would mint a
  // razorpay pickup row — and once Razorpay has the money, refusing it later
  // only orphans the payment (see the standing rule in /api/verify-payment:
  // refuse at creation, never at attribution). Creation is the only place a
  // refusal is free.
  //
  // ASKED THROUGH isPayableOnline, NOT A FRESH `=== "pickup"` TEST. The whole
  // point of order-payable.ts is that one rule has one spelling; a second
  // spelling here would be free to drift from the one the Pay Now button and
  // /api/orders/[id]/pay use, and the drift would show up as a pickup order
  // that can be created online but not resumed, or vice versa. So describe the
  // row this route is ABOUT to insert and ask the shared predicate about it.
  // `created_at` is the honest value: the insert is moments away, and the
  // grandfather cutoff is read against it. A consequence worth knowing: if the
  // cutoff is ever moved into the future, this refusal relaxes with it, which
  // is the same answer the resume path would give.
  if (
    !isPayableOnline({
      payment_method: "razorpay",
      payment_status: "created",
      status: "pending",
      fulfillment_type: prepared.fulfillmentType,
      created_at: new Date().toISOString(),
    })
  ) {
    return NextResponse.json(
      {
        error:
          "Pickup orders are paid at the counter when you collect. Please " +
          "place the order and pay on collection.",
        code: "pickup_pay_at_counter",
      },
      { status: 400 },
    );
  }

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
      // Stamped HERE, not inside orderInsertColumns — see the note in
      // /api/checkout. The helper is shared with the admin register route.
      source: "web",
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
