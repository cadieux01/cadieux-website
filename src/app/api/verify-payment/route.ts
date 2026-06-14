// POST /api/verify-payment
//
// Called by the client immediately after the Razorpay checkout `handler`
// fires. This is the ONLY place a one-time order is marked paid, and it
// happens ONLY after the HMAC signature is verified server-side with the
// secret key. The client's "payment succeeded" callback is never trusted
// on its own.
//
// Request body:
//   { db_order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature }
//
// Verification chain (any failure → order NOT marked paid):
//   1. HMAC_SHA256(order_id|payment_id, KEY_SECRET) === razorpay_signature
//   2. the DB order row exists and its stored razorpay_order_id matches
//   3. Razorpay's own record of the payment is captured, for this order,
//      for the exact server-stored amount
// Idempotent: a row already marked paid returns success without re-writing.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** Constant-time hex-string compare; false on any length/format mismatch. */
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    db_order_id?: unknown;
    razorpay_order_id?: unknown;
    razorpay_payment_id?: unknown;
    razorpay_signature?: unknown;
  };

  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) {
    return NextResponse.json({ error: "Razorpay not configured" }, { status: 503 });
  }

  const dbOrderId = typeof body.db_order_id === "string" ? body.db_order_id : "";
  const rzpOrderId =
    typeof body.razorpay_order_id === "string" ? body.razorpay_order_id : "";
  const rzpPaymentId =
    typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
  const rzpSignature =
    typeof body.razorpay_signature === "string" ? body.razorpay_signature : "";

  if (!dbOrderId || !rzpOrderId || !rzpPaymentId || !rzpSignature) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // 1. Signature check — proves the payload came from Razorpay and was
  //    not forged by the client.
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${rzpOrderId}|${rzpPaymentId}`)
    .digest("hex");
  if (!safeEqualHex(expected, rzpSignature)) {
    console.warn("⚠️  verify-payment signature mismatch", { dbOrderId, rzpOrderId });
    return NextResponse.json(
      { error: "Payment verification failed.", code: "signature_invalid" },
      { status: 400 },
    );
  }

  // 2. Locate the order we created in /api/create-order and confirm the
  //    razorpay order id binds to it.
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select("id, total_amount, razorpay_order_id, payment_status")
    .eq("id", dbOrderId)
    .maybeSingle();
  if (orderErr) {
    console.error("[verify-payment] order fetch failed:", orderErr.message);
    return NextResponse.json({ error: "Failed to verify order" }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  if (order.razorpay_order_id !== rzpOrderId) {
    console.warn("⚠️  verify-payment order id mismatch", {
      dbOrderId,
      stored: order.razorpay_order_id,
      sent: rzpOrderId,
    });
    return NextResponse.json(
      { error: "Payment verification failed.", code: "order_mismatch" },
      { status: 400 },
    );
  }

  // Idempotent: webhook or a previous call may already have marked it.
  if (order.payment_status === "paid") {
    return NextResponse.json({ ok: true, order_id: order.id, already: true });
  }

  // 3. Independently confirm the payment with Razorpay — never rely on the
  //    signature alone for amount/capture state.
  const authHeader = Buffer.from(`${key}:${secret}`).toString("base64");
  const payRes = await fetch(
    `https://api.razorpay.com/v1/payments/${encodeURIComponent(rzpPaymentId)}`,
    { headers: { Authorization: `Basic ${authHeader}` } },
  );
  const payment = (await payRes.json()) as {
    id?: string;
    status?: string;
    order_id?: string;
    amount?: number;
    error?: { description?: string };
  };
  if (!payRes.ok) {
    return NextResponse.json(
      { error: payment.error?.description ?? "Razorpay lookup failed" },
      { status: 502 },
    );
  }

  const expectedAmount = Math.round(Number(order.total_amount) * 100);
  if (
    payment.status !== "captured" ||
    payment.order_id !== rzpOrderId ||
    payment.amount !== expectedAmount
  ) {
    console.warn("⚠️  verify-payment payment state mismatch", {
      dbOrderId,
      status: payment.status,
      payment_order: payment.order_id,
      amount: payment.amount,
      expectedAmount,
    });
    return NextResponse.json(
      { error: "Payment not captured.", code: "not_captured" },
      { status: 400 },
    );
  }

  // Verified — mark paid. Only flip a row that is not already paid.
  const { error: updErr } = await supabaseAdmin
    .from("orders")
    .update({
      payment_status: "paid",
      razorpay_payment_id: rzpPaymentId,
      paid_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .neq("payment_status", "paid");
  if (updErr) {
    console.error("[verify-payment] mark-paid failed:", updErr.message);
    return NextResponse.json({ error: "Failed to mark order paid" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, order_id: order.id });
}
