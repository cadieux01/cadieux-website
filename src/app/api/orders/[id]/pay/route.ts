// POST /api/orders/[id]/pay
//
// "Pay Now": lets the verified-phone customer who owns an UNPAID order pay it
// online. This route creates a Razorpay order for the existing order's CURRENT
// total and stamps the razorpay_order_id on the SAME row — it does NOT create a
// new order and does NOT mark the order paid. The paid flip happens only after a
// verified signature in /api/orders/[id]/pay/verify (mirrors the
// /api/create-order → /api/verify-payment split used by the checkout flow).
//
// Auth: cookie-based via getVerifiedPhone(req). The order must belong to the
// verified phone's customer, otherwise 404 (don't leak unrelated orders).
//
// Guard: not already paid, not cancelled, and payable per isPayableOnline().
// This route used to refuse everything whose payment_method was not `cod`, and
// that one check was the whole reason a dismissed Razorpay window could never be
// finished — src/lib/order-payable.ts now owns the rule, so the customer's button
// and this gate cannot disagree. The amount sent to Razorpay is read from the DB
// row on the server; the client cannot influence it.
//
// REUSE, DON'T RE-MINT. This route used to create a fresh Razorpay order on
// every press and overwrite orders.razorpay_order_id unconditionally. Two
// presses — a customer tapping again, a slow network, a back-and-forward —
// orphaned the first Razorpay order: the id was gone from every row we own,
// while its checkout window was still open and still able to take money.
// Completing that first window then captured real money against an id nothing
// could be found by, which is the /api/razorpay-webhook "unattributed" case
// and the reason payment_exceptions exists. So: if the row already carries a
// Razorpay order that Razorpay itself says is unpaid, for the same amount and
// currency, hand that one back. One press, one Razorpay order, one live
// checkout window.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getVerifiedPhone,
  rollPhoneCookieOnWebRequest,
} from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";
import { razorpayOrderIsReusable } from "@/lib/razorpay-order-reuse";
import { isPayableOnline } from "@/lib/order-payable";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = (params.id || "").trim();
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }

  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) {
    return NextResponse.json({ error: "Razorpay not configured" }, { status: 503 });
  }

  const verified = getVerifiedPhone(req);
  if (!verified) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) {
    return NextResponse.json({ error: "Phone format" }, { status: 400 });
  }

  // Resolve the customer that owns the verified phone.
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (!customer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Load the order, scoped to this customer.
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select(
      "id, customer_id, total_amount, status, payment_method, payment_status, razorpay_order_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (orderErr) {
    console.error("[orders/pay] order fetch failed:", orderErr.message);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
  if (!order || order.customer_id !== customer.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Guard: not-already-paid, not-cancelled, and payable per order-payable.ts.
  const payStatus = (order.payment_status ?? "").toLowerCase();
  const status = (order.status ?? "").toLowerCase();
  if (payStatus === "paid") {
    return NextResponse.json(
      { error: "Order already paid", code: "already_paid" },
      { status: 409 },
    );
  }
  if (!isPayableOnline(order)) {
    return NextResponse.json(
      {
        error:
          "This order can no longer be paid online. Please message us on " +
          "WhatsApp and we'll sort it out.",
        code: "not_payable",
      },
      { status: 409 },
    );
  }
  if (status === "cancelled") {
    return NextResponse.json(
      { error: "Order is cancelled", code: "cancelled" },
      { status: 409 },
    );
  }

  const amount = Math.round(Number(order.total_amount) * 100); // paise, integer
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Invalid order amount" }, { status: 400 });
  }

  const auth = Buffer.from(`${key}:${secret}`).toString("base64");

  // Hand back the order already on this row, if Razorpay says it is still a
  // live, untouched window for this exact amount. No write: the row already
  // carries this id, so there is nothing to bind and nothing to overwrite.
  if (order.razorpay_order_id) {
    const check = await razorpayOrderIsReusable(
      order.razorpay_order_id,
      amount,
      auth,
    );
    if (check.reuse) {
      const res = NextResponse.json({
        razorpay_order_id: order.razorpay_order_id,
        amount: check.amountPaise, // paise (confirmed by Razorpay, not by us)
        currency: check.currency,
        key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      });
      rollPhoneCookieOnWebRequest(req, res);
      return res;
    }
    // `loud` = Razorpay has money against an order our row still calls unpaid.
    // Minting a fresh one is still correct, but this is the orphaned-money
    // shape and it must not pass in silence.
    const line =
      `[orders/pay] minting a new razorpay order for ${order.id} — ` +
      `existing one not reusable: ${check.why} (rzp_order=${order.razorpay_order_id})`;
    if (check.loud) console.error(line);
    else console.log(line);
  }

  // Create the Razorpay order for the server-confirmed total.
  const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount,
      currency: "INR",
      receipt: `cadieux_paynow_${order.id.slice(0, 8)}_${Date.now()}`,
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

  // Bind the razorpay order id to the existing row so the verify step can
  // reconcile against it. Do NOT change payment_method/payment_status/status
  // here — that only happens after a verified signature.
  //
  // This still overwrites any previous id, and that is now deliberate rather
  // than accidental: we only reach here having ASKED Razorpay and been told
  // the old one is unusable (paid, part-paid, a different amount, or
  // unreachable). One id per row means the column can only ever point at the
  // window we most recently believed was live.
  const { error: updErr } = await supabaseAdmin
    .from("orders")
    .update({ razorpay_order_id: rzp.id })
    .eq("id", order.id)
    .neq("payment_status", "paid");
  if (updErr) {
    console.error("[orders/pay] bind razorpay_order_id failed:", updErr.message);
    return NextResponse.json({ error: "Failed to start payment" }, { status: 500 });
  }

  const res = NextResponse.json({
    razorpay_order_id: rzp.id,
    amount: rzp.amount, // paise (server-confirmed)
    currency: rzp.currency,
    key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
  });
  rollPhoneCookieOnWebRequest(req, res);
  return res;
}
