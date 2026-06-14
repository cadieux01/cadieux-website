// POST /api/mobile/verify-payment
//
// Mobile counterpart to /api/verify-payment. Called by the app right after
// the native Razorpay checkout success callback fires. This is the ONLY
// place a mobile online order is marked paid, and it happens ONLY after the
// HMAC signature is verified server-side with the KEY SECRET. The app's
// local "payment succeeded" callback is never trusted on its own.
//
// Auth (identical to /api/mobile/checkout + create-order):
//   • X-App-Key friction header
//   • Authorization: Bearer <30-day phone token>
//
// Request body:
//   { db_order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature }
//
// Verification chain (any failure → order NOT marked paid):
//   1. HMAC_SHA256(order_id|payment_id, KEY_SECRET) === razorpay_signature
//   2. the DB order row exists, belongs to the verified phone's customer,
//      and its stored razorpay_order_id matches
//   3. Razorpay's own record of the payment is captured, for this order,
//      for the exact server-stored amount
// Idempotent: a row already marked paid returns success without re-writing.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { getVerifiedPhone, isValidMobileAppKey } from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";

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
  if (!process.env.MOBILE_APP_KEY) {
    return NextResponse.json(
      { ok: false, error: "Server misconfigured" },
      { status: 500 },
    );
  }

  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) {
    return NextResponse.json(
      { ok: false, error: "Razorpay not configured" },
      { status: 503 },
    );
  }

  // 1. App-key friction check.
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  // 2. Bearer-token auth.
  const verified = getVerifiedPhone(req);
  if (!verified) {
    return NextResponse.json(
      { ok: false, error: "Phone not verified" },
      { status: 401 },
    );
  }
  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) {
    return NextResponse.json(
      { ok: false, error: "Verified phone is not in expected format" },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    db_order_id?: unknown;
    razorpay_order_id?: unknown;
    razorpay_payment_id?: unknown;
    razorpay_signature?: unknown;
  };

  const dbOrderId =
    typeof body.db_order_id === "string" ? body.db_order_id : "";
  const rzpOrderId =
    typeof body.razorpay_order_id === "string" ? body.razorpay_order_id : "";
  const rzpPaymentId =
    typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
  const rzpSignature =
    typeof body.razorpay_signature === "string" ? body.razorpay_signature : "";

  if (!dbOrderId || !rzpOrderId || !rzpPaymentId || !rzpSignature) {
    return NextResponse.json(
      { ok: false, error: "Missing fields" },
      { status: 400 },
    );
  }

  // 3. Signature check — proves the payload came from Razorpay and was
  //    not forged by the client.
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${rzpOrderId}|${rzpPaymentId}`)
    .digest("hex");
  if (!safeEqualHex(expected, rzpSignature)) {
    console.warn("⚠️  mobile verify-payment signature mismatch", {
      dbOrderId,
      rzpOrderId,
    });
    return NextResponse.json(
      { ok: false, error: "Payment verification failed.", code: "signature_invalid" },
      { status: 400 },
    );
  }

  // 4. Locate the order and confirm it belongs to the verified phone's
  //    customer and binds to this razorpay order id.
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select(
      "id, total_amount, razorpay_order_id, payment_status, customer_id, customers!inner(phone)",
    )
    .eq("id", dbOrderId)
    .maybeSingle();
  if (orderErr) {
    console.error("[mobile/verify-payment] order fetch failed:", orderErr.message);
    return NextResponse.json(
      { ok: false, error: "Failed to verify order" },
      { status: 500 },
    );
  }
  if (!order) {
    return NextResponse.json(
      { ok: false, error: "Order not found." },
      { status: 404 },
    );
  }

  // Ownership: the order's customer must be the verified phone.
  const ownerPhone = (order as { customers?: { phone?: string } }).customers
    ?.phone;
  if (!ownerPhone || toLocal10(String(ownerPhone)) !== phoneLocal) {
    console.warn("⚠️  mobile verify-payment ownership mismatch", { dbOrderId });
    return NextResponse.json(
      { ok: false, error: "Payment verification failed.", code: "ownership_mismatch" },
      { status: 403 },
    );
  }

  if (order.razorpay_order_id !== rzpOrderId) {
    console.warn("⚠️  mobile verify-payment order id mismatch", {
      dbOrderId,
      stored: order.razorpay_order_id,
      sent: rzpOrderId,
    });
    return NextResponse.json(
      { ok: false, error: "Payment verification failed.", code: "order_mismatch" },
      { status: 400 },
    );
  }

  // Idempotent: a prior call may already have marked it paid.
  if (order.payment_status === "paid") {
    return NextResponse.json({ ok: true, order_id: order.id, already: true });
  }

  // 5. Independently confirm the payment with Razorpay — never rely on the
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
      { ok: false, error: payment.error?.description ?? "Razorpay lookup failed" },
      { status: 502 },
    );
  }

  const expectedAmount = Math.round(Number(order.total_amount) * 100);
  if (
    payment.status !== "captured" ||
    payment.order_id !== rzpOrderId ||
    payment.amount !== expectedAmount
  ) {
    console.warn("⚠️  mobile verify-payment payment state mismatch", {
      dbOrderId,
      status: payment.status,
      payment_order: payment.order_id,
      amount: payment.amount,
      expectedAmount,
    });
    return NextResponse.json(
      { ok: false, error: "Payment not captured.", code: "not_captured" },
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
    console.error("[mobile/verify-payment] mark-paid failed:", updErr.message);
    return NextResponse.json(
      { ok: false, error: "Failed to mark order paid" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, order_id: order.id });
}
