// POST /api/mobile/subscriptions/verify-payment
//
// Mobile counterpart to /api/subscriptions/verify-payment. The ONLY place
// a subscription placed from the app is marked paid, and only after the
// HMAC signature is verified server-side. The app's local "payment
// succeeded" callback is never trusted on its own.
//
// Auth (identical to /api/mobile/subscriptions):
//   • X-App-Key friction header
//   • Authorization: Bearer <30-day phone token>
//
// The row lookup is additionally SCOPED to the verified caller's customer
// id, so one customer can never mark another's subscription paid.
//
// The verification chain itself lives in @/lib/subscription-payment so the
// website and the app cannot drift apart.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { getVerifiedPhone, isValidMobileAppKey } from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";
import { verifySubscriptionPayment } from "@/lib/subscription-payment";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export async function POST(req: NextRequest) {
  if (!process.env.MOBILE_APP_KEY) {
    return NextResponse.json(
      { ok: false, error: "Server misconfigured" },
      { status: 500 },
    );
  }
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

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

  // Resolve the caller's customer id so the row lookup can be scoped.
  const { data: cust, error: custErr } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (custErr) {
    console.error(
      "[mobile/subscriptions/verify-payment] customer lookup:",
      custErr.message,
    );
    return NextResponse.json(
      { ok: false, error: "Failed to verify subscription" },
      { status: 500 },
    );
  }
  if (!cust) {
    return NextResponse.json(
      { ok: false, error: "Subscription not found." },
      { status: 404 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const result = await verifySubscriptionPayment(
    supabaseAdmin,
    {
      subscription_id: String(body.subscription_id ?? ""),
      razorpay_order_id: String(body.razorpay_order_id ?? ""),
      razorpay_payment_id: String(body.razorpay_payment_id ?? ""),
      razorpay_signature: String(body.razorpay_signature ?? ""),
    },
    { customer_id: cust.id as string },
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, code: result.code },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    subscription_id: result.subscription_id,
    already_paid: result.already ?? false,
  });
}
