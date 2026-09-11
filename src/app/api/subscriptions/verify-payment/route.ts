// POST /api/subscriptions/verify-payment
//
// The ONLY place a subscription is marked paid. Mirrors
// /api/verify-payment for one-time orders — the client's "payment
// succeeded" callback is never trusted on its own.
//
// Request body:
//   { subscription_id, razorpay_order_id, razorpay_payment_id, razorpay_signature }
//
// The whole verification chain lives in @/lib/subscription-payment so the
// website and the mobile app cannot drift apart.
//
// One failure the caller must branch on specifically:
//   HTTP 409 { code: "subscription_orphaned", error: <copy>, subscription_id }
// The money WAS captured, but it arrived after the sweeper had written the
// subscription off, so nothing is scheduled. It is a failure (not `success`)
// on purpose — a client branching only on the success flag must land on the
// fail-safe side. /subscriptions/setup/payment renders `error` verbatim and
// suppresses the retry path; anything else that calls this must do the same.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { verifySubscriptionPayment } from "@/lib/subscription-payment";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const result = await verifySubscriptionPayment(supabaseAdmin, {
    subscription_id: String(body.subscription_id ?? ""),
    razorpay_order_id: String(body.razorpay_order_id ?? ""),
    razorpay_payment_id: String(body.razorpay_payment_id ?? ""),
    razorpay_signature: String(body.razorpay_signature ?? ""),
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        code: result.code,
        // Present only on the orphaned branch, where the row DOES exist.
        subscription_id: result.subscription_id,
      },
      { status: result.status },
    );
  }

  return NextResponse.json({
    success: true,
    subscription_id: result.subscription_id,
    already_paid: result.already ?? false,
  });
}
