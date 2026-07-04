// POST /api/orders/[id]/pay
//
// "Pay Now": lets the verified-phone customer who owns a COD order convert it
// to an online (Razorpay) payment. This route creates a Razorpay order for the
// existing order's CURRENT total and stamps the razorpay_order_id on the SAME
// row — it does NOT create a new order and does NOT mark the order paid. The
// paid flip happens only after a verified signature in
// /api/orders/[id]/pay/verify (mirrors the /api/create-order → /api/verify-payment
// split used by the checkout flow).
//
// Auth: cookie-based via getVerifiedPhone(req). The order must belong to the
// verified phone's customer, otherwise 404 (don't leak unrelated orders).
//
// Guard: only COD orders that are not already paid and not cancelled can be
// paid. The amount sent to Razorpay is read from the DB row on the server; the
// client cannot influence it.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getVerifiedPhone,
  rollPhoneCookieOnWebRequest,
} from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";

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
    .select("id, customer_id, total_amount, status, payment_method, payment_status")
    .eq("id", id)
    .maybeSingle();
  if (orderErr) {
    console.error("[orders/pay] order fetch failed:", orderErr.message);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
  if (!order || order.customer_id !== customer.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Guard: only COD, not-already-paid, not-cancelled orders are payable.
  const method = (order.payment_method ?? "").toLowerCase();
  const payStatus = (order.payment_status ?? "").toLowerCase();
  const status = (order.status ?? "").toLowerCase();
  if (payStatus === "paid") {
    return NextResponse.json(
      { error: "Order already paid", code: "already_paid" },
      { status: 409 },
    );
  }
  if (method !== "cod") {
    return NextResponse.json(
      { error: "Order is not a Cash-on-Delivery order", code: "not_cod" },
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

  // Create the Razorpay order for the server-confirmed total.
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
