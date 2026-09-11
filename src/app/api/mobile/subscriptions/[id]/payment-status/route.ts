// GET /api/mobile/subscriptions/[id]/payment-status
//
// A narrow, read-only endpoint the app uses to resume a subscription
// payment across an app restart.
//
// WHY A SEPARATE ENDPOINT
// The primary detail endpoint (/api/mobile/subscriptions/[id]) deliberately
// returns 404 for rows in the UNPAID_SUBSCRIPTION_STATUSES set — those
// rows are audit-only, they must not leak into any customer or admin list.
// But the app that owns a still-resumable checkout DOES need to know
// whether its pending sub is still resumable, already paid, or gone. A
// dedicated status probe lets us answer that without relaxing the
// visibility invariant everywhere else.
//
// WHAT IT RETURNS
// A tiny enum. No delivery list, no address, no total — just enough to
// decide which UI to show:
//
//   paid          — paid and scheduled. Show live subscription. This covers
//                   BOTH the normal verify path and a row the sweeper
//                   rescued (reconciled_at set) — a rescue is a success, the
//                   deliveries are intact, so it is plain `paid`.
//   paid_orphaned — we are holding money and NOTHING is scheduled: the
//                   payment landed after the sweeper had already written the
//                   row off and cancelled its deliveries. Show "we have your
//                   payment, nothing is scheduled, our team will call you".
//                   Keyed on payment_status = 'paid_orphaned' ONLY.
//
//                   NOT keyed on reconciled_at. reconciled_at means the
//                   sweeper RESCUED this row — a success marker. An earlier
//                   draft derived this enum from
//                   `payment_status='paid' AND reconciled_at IS NOT NULL`,
//                   which inverted the two: it would have told a customer
//                   whose subscription was successfully rescued that we were
//                   sitting on their money with nothing scheduled.
//   created       — still resumable. App re-opens Razorpay checkout with
//                   the stored razorpay_order_id.
//   abandoned     — sweeper confirmed with Razorpay that no payment was
//                   ever collected. App tells the customer to start over.
//   not_found     — no such row, or the row is not owned by the caller.
//                   Both cases collapse to one response — a bare id-to-
//                   status probe is a subscription oracle otherwise.
//
// OWNER SCOPED
// Same customer_id lookup as verify-payment. A subscription that exists
// but is owned by someone else returns not_found, exactly as if it didn't
// exist. This is why the endpoint returns 200 with a status enum rather
// than 404 for missing rows — a 404 vs 200 split would itself leak the
// existence of another customer's row.
//
// NOT WRITE-ONLY-ENOUGH TO EXEMPT FROM APP-KEY / PHONE AUTH — same auth
// contract as every other /api/mobile/* endpoint.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { getVerifiedPhone, isValidMobileAppKey } from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export const dynamic = "force-dynamic";
export const revalidate = 0;

export type SubscriptionPaymentStatus =
  | "paid"
  | "paid_orphaned"
  | "created"
  | "abandoned"
  | "not_found";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function respond(status: SubscriptionPaymentStatus) {
  return NextResponse.json({ ok: true, status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!process.env.MOBILE_APP_KEY) return fail(500, "Server misconfigured");
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return fail(401, "Unauthorized");
  }
  const verified = getVerifiedPhone(req);
  if (!verified) return fail(401, "Phone not verified");
  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) {
    return fail(400, "Verified phone is not in expected format");
  }

  // Resolve customer by phone to scope the row lookup. A missing customer
  // record collapses to not_found — same result as a non-owning caller,
  // which is deliberate: don't leak whether the customer record exists
  // separately from whether the subscription exists.
  const { data: customer, error: custErr } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (custErr) {
    console.error(
      "[mobile/subscriptions/:id/payment-status] customer lookup:",
      custErr.message,
    );
    return fail(500, "Failed to resolve customer");
  }
  if (!customer) return respond("not_found");

  // reconciled_at is deliberately NOT selected. It is a SUCCESS marker (the
  // sweeper rescued this row) and must never be read as evidence of an
  // orphan. Selecting it here is how it would get re-wired into the test
  // below by the next person to touch this file.
  const { data: sub, error: subErr } = await supabaseAdmin
    .from("subscriptions")
    .select("id, payment_status")
    .eq("id", params.id)
    .eq("customer_id", customer.id)
    .maybeSingle();
  if (subErr) {
    console.error(
      "[mobile/subscriptions/:id/payment-status] sub fetch:",
      subErr.message,
    );
    return fail(500, "Failed to fetch subscription");
  }
  if (!sub) return respond("not_found");

  const paymentStatus = String(sub.payment_status ?? "");

  // 'paid' means paid, whether the app verified it or the sweeper rescued it.
  // A rescued row IS a live subscription with live deliveries, so it must
  // report `paid`.
  if (paymentStatus === "paid") return respond("paid");
  // The orphan test is the status VALUE and nothing else. 'paid_orphaned' is
  // written only by the verify path, when money landed on a row the sweeper
  // had already written off: we hold the money and nothing is scheduled.
  if (paymentStatus === "paid_orphaned") return respond("paid_orphaned");
  if (paymentStatus === "created") return respond("created");
  if (paymentStatus === "abandoned") return respond("abandoned");

  // Anything else (e.g. legacy pending COD rows that got here by id) is
  // NOT a payment-flow state this endpoint speaks to. Report not_found so
  // the app doesn't try to resume a Razorpay flow that never applied.
  return respond("not_found");
}
