// POST /api/razorpay-webhook
//
// Server-to-server backup for marking orders paid. If the browser closes
// before /api/verify-payment runs (network drop, tab closed right after
// paying), Razorpay still delivers a signed webhook and this endpoint
// reconciles the order. Both paths are idempotent and converge on the
// same `paid` state.
//
// Configure in the Razorpay dashboard:
//   URL:    https://www.cadieux.in/api/razorpay-webhook
//   Secret: value of RAZORPAY_WEBHOOK_SECRET (set the SAME value in Vercel)
//   Events: payment.captured, payment.failed, order.paid
//
// Security: the X-Razorpay-Signature header is an HMAC-SHA256 of the EXACT
// raw request body keyed by the webhook secret. We must hash the unparsed
// bytes — re-serialising the JSON would change them and break the check.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

type RzpEntity = {
  id?: string;
  order_id?: string;
  amount?: number;
  status?: string;
};

export async function POST(req: NextRequest) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  // Raw body is mandatory for an exact-bytes HMAC.
  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  if (!signature || !safeEqualHex(expected, signature)) {
    console.warn("⚠️  razorpay-webhook bad signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: {
    event?: string;
    payload?: {
      payment?: { entity?: RzpEntity };
      order?: { entity?: RzpEntity };
    };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  const payment = event.payload?.payment?.entity;
  const orderEntity = event.payload?.order?.entity;
  // order.paid carries the order entity; payment.* carry the payment entity
  // whose order_id points back at our order.
  const rzpOrderId = payment?.order_id ?? orderEntity?.id ?? null;

  if (!rzpOrderId) {
    // Nothing to reconcile (e.g. an event type we don't map). Ack so
    // Razorpay doesn't retry.
    return NextResponse.json({ ok: true, ignored: event.event ?? null });
  }

  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select("id, total_amount, payment_status")
    .eq("razorpay_order_id", rzpOrderId)
    .maybeSingle();
  if (orderErr) {
    console.error("[razorpay-webhook] order fetch failed:", orderErr.message);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
  if (!order) {
    // Unknown order — ack to stop retries; nothing for us to do.
    return NextResponse.json({ ok: true, unknown_order: rzpOrderId });
  }

  if (event.event === "payment.failed") {
    if (order.payment_status !== "paid") {
      await supabaseAdmin
        .from("orders")
        .update({ payment_status: "failed" })
        .eq("id", order.id)
        .neq("payment_status", "paid");
    }
    return NextResponse.json({ ok: true });
  }

  // payment.captured / order.paid → mark paid, idempotently, only if the
  // captured amount matches the server-stored total.
  if (event.event === "payment.captured" || event.event === "order.paid") {
    if (order.payment_status === "paid") {
      return NextResponse.json({ ok: true, already: true });
    }
    const captured = Number(payment?.amount ?? orderEntity?.amount);
    const expectedAmount = Math.round(Number(order.total_amount) * 100);
    if (Number.isFinite(captured) && captured !== expectedAmount) {
      console.warn("⚠️  razorpay-webhook amount mismatch", {
        rzpOrderId,
        captured,
        expectedAmount,
      });
      return NextResponse.json({ ok: true, amount_mismatch: true });
    }
    await supabaseAdmin
      .from("orders")
      .update({
        payment_status: "paid",
        ...(payment?.id ? { razorpay_payment_id: payment.id } : {}),
        paid_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .neq("payment_status", "paid");
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true, ignored: event.event ?? null });
}
