// POST /api/orders/[id]/pay/verify
//
// Verifies a Razorpay payment for an EXISTING (COD → online) order and flips
// the SAME row to paid. This is the owner-scoped "Pay Now" counterpart to
// /api/verify-payment: it runs the identical secure verification chain but,
// instead of trusting an unauthenticated db_order_id, it scopes the order to
// the verified phone's customer.
//
// Request body:
//   { razorpay_order_id, razorpay_payment_id, razorpay_signature }
// (the order id comes from the path, not the body.)
//
// Verification chain (any failure → order NOT marked paid):
//   1. HMAC_SHA256(order_id|payment_id, KEY_SECRET) === razorpay_signature
//   2. the DB order row exists, is owned by the verified phone, and its stored
//      razorpay_order_id matches the one being verified
//   3. Razorpay's own record of the payment is captured, for this order, for
//      the exact server-stored amount
// Idempotent: a row already marked paid returns success without re-writing.
// On success: payment_status='paid', payment_method='razorpay',
// razorpay_payment_id, paid_at=now(). The delivery `status` is left untouched.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
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

/** Constant-time hex-string compare; false on any length/format mismatch. */
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

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

  const body = (await req.json().catch(() => ({}))) as {
    razorpay_order_id?: unknown;
    razorpay_payment_id?: unknown;
    razorpay_signature?: unknown;
  };
  const rzpOrderId =
    typeof body.razorpay_order_id === "string" ? body.razorpay_order_id : "";
  const rzpPaymentId =
    typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
  const rzpSignature =
    typeof body.razorpay_signature === "string" ? body.razorpay_signature : "";
  if (!rzpOrderId || !rzpPaymentId || !rzpSignature) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // 1. Signature check — proves the payload came from Razorpay.
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${rzpOrderId}|${rzpPaymentId}`)
    .digest("hex");
  if (!safeEqualHex(expected, rzpSignature)) {
    console.warn("⚠️  orders/pay/verify signature mismatch", { id, rzpOrderId });
    return NextResponse.json(
      { error: "Payment verification failed.", code: "signature_invalid" },
      { status: 400 },
    );
  }

  // Resolve owner.
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (!customer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 2. Locate the order, scoped to this customer, and confirm the razorpay
  //    order id binds to it.
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select("id, customer_id, total_amount, razorpay_order_id, payment_status")
    .eq("id", id)
    .maybeSingle();
  if (orderErr) {
    console.error("[orders/pay/verify] order fetch failed:", orderErr.message);
    return NextResponse.json({ error: "Failed to verify order" }, { status: 500 });
  }
  if (!order || order.customer_id !== customer.id) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  if (order.razorpay_order_id !== rzpOrderId) {
    console.warn("⚠️  orders/pay/verify order id mismatch", {
      id,
      stored: order.razorpay_order_id,
      sent: rzpOrderId,
    });
    return NextResponse.json(
      { error: "Payment verification failed.", code: "order_mismatch" },
      { status: 400 },
    );
  }

  // Idempotent: already paid → success without re-writing.
  if (order.payment_status === "paid") {
    const res = NextResponse.json({ ok: true, order_id: order.id, already: true });
    rollPhoneCookieOnWebRequest(req, res);
    return res;
  }

  // 3. Independently confirm the payment with Razorpay.
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
    console.warn("⚠️  orders/pay/verify payment state mismatch", {
      id,
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

  // Verified — flip the SAME row to paid. Delivery `status` is untouched.
  const { error: updErr } = await supabaseAdmin
    .from("orders")
    .update({
      payment_status: "paid",
      payment_method: "razorpay",
      razorpay_payment_id: rzpPaymentId,
      paid_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .neq("payment_status", "paid");
  if (updErr) {
    console.error("[orders/pay/verify] mark-paid failed:", updErr.message);
    return NextResponse.json({ error: "Failed to mark order paid" }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true, order_id: order.id });
  rollPhoneCookieOnWebRequest(req, res);
  return res;
}
