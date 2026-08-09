// POST /api/mobile/orders/[id]/cancel
//
// Customer-initiated order cancellation. The rule (mirroring /refunds):
// a full refund is granted if the request lands within
// CANCELLATION_WINDOW_MINUTES of orders.created_at. Outside the window,
// no cancel — the customer is steered toward reschedule/support.
//
// Defensive ordering of checks (bad actors are assumed):
//   1. App key + verified bearer (same as every other mobile route).
//   2. Resolve the customer row from the verified phone.
//   3. Resolve the order, scoped to that customer_id. Mismatch → 404, not
//      403, so we don't leak existence to non-owners.
//   4. Status gate: cancellable / terminal / dispatched-or-later.
//   5. Time gate: server clock vs created_at — NOT a client-supplied
//      timestamp — so a stale or tampered client cannot extend the window.
//   6. Single UPDATE; return the row.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getVerifiedPhone,
  isValidMobileAppKey,
  maskPhone,
} from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";
import {
  CANCELLABLE_STATUSES,
  isWithinCancellationWindow,
  canAutoRefund,
} from "@/lib/order-cancellation";
import { issueRazorpayRefund } from "@/lib/razorpay-refund";
import { notifyCustomer } from "@/lib/push";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const REASON_MAX = 500;

function fail(status: number, error: string, code?: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  // ----- 1. Auth -----
  if (!process.env.MOBILE_APP_KEY) return fail(500, "Server misconfigured");
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return fail(401, "Unauthorized");
  }
  const verified = getVerifiedPhone(req);
  if (!verified) return fail(401, "Phone not verified");
  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) return fail(400, "Phone format");

  const orderId = params.id;
  if (!orderId || typeof orderId !== "string") {
    return fail(400, "Bad order id", "bad_id");
  }

  // Optional cancellation reason from body. Body is OPTIONAL — empty POST is
  // valid. Bad JSON → ignored (treated as no reason) rather than 400, so the
  // happy path is forgiving while the explicit-reason path is bounded.
  const raw = (await req.json().catch(() => null)) as unknown;
  let reason: string | null = null;
  if (raw && typeof raw === "object") {
    const r = (raw as Record<string, unknown>).reason;
    if (typeof r === "string") {
      const trimmed = r.trim();
      if (trimmed.length > REASON_MAX) {
        return fail(
          400,
          `Reason exceeds ${REASON_MAX} characters.`,
          "reason_too_long",
        );
      }
      reason = trimmed === "" ? null : trimmed;
    }
  }

  // ----- 2. Customer -----
  const { data: customer, error: custErr } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (custErr) {
    console.error("[mobile/order cancel] customer lookup:", custErr.message);
    return fail(500, "Lookup failed");
  }
  if (!customer) return fail(404, "Not found");

  // ----- 3. Order (scoped to this customer) -----
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select(
      "id, status, created_at, payment_status, payment_method, razorpay_payment_id, refund_status, refund_id, total_amount",
    )
    .eq("id", orderId)
    .eq("customer_id", customer.id)
    .maybeSingle();
  if (orderErr) {
    console.error("[mobile/order cancel] order lookup:", orderErr.message);
    return fail(500, "Lookup failed");
  }
  if (!order) return fail(404, "Not found");

  // ----- 4. Status gate -----
  if (order.status === "cancelled" || order.status === "refunded") {
    return fail(
      400,
      "This order has already been cancelled.",
      "already_cancelled",
    );
  }
  if (!CANCELLABLE_STATUSES.has(order.status)) {
    // pending_payment, dispatched, out_for_delivery, delivered, etc.
    return fail(
      400,
      "This order has already been dispatched and cannot be cancelled.",
      "not_cancellable",
    );
  }

  // ----- 5. Time gate (server clock only) -----
  if (!isWithinCancellationWindow(order.created_at)) {
    console.info("[mobile/order cancel] window expired", {
      orderId,
      phone: maskPhone(phoneLocal),
      created_at: order.created_at,
    });
    return fail(
      400,
      "The 1-hour cancellation window has expired. You can reschedule future deliveries instead.",
      "cancellation_window_expired",
    );
  }

  // ----- 6. Cancel (money-neutral) -----
  // Mark the order cancelled first. refund_status is deliberately NOT set here.
  // The auto-refund step below reserves it via a compare-and-swap, so a
  // double-cancel can never trigger a double-refund. COD/unpaid orders never
  // reach the refund step at all (see canAutoRefund).
  const nowIso = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("orders")
    .update({
      status: "cancelled",
      cancelled_at: nowIso,
      cancellation_reason: reason,
    })
    .eq("id", orderId)
    .eq("customer_id", customer.id)
    // Defensive: only update if status is still in a cancellable state. This
    // protects against a TOCTOU race where the order gets dispatched between
    // our read and write.
    .in("status", Array.from(CANCELLABLE_STATUSES))
    .select("id, status, cancelled_at, cancellation_reason, refund_status")
    .maybeSingle();
  if (updateErr) {
    console.error("[mobile/order cancel] update:", updateErr.message);
    return fail(500, "Failed to cancel order");
  }
  if (!updated) {
    // Status changed between our SELECT and UPDATE.
    return fail(
      409,
      "Order status changed. Please refresh and try again.",
      "status_changed",
    );
  }

  // ----- 7. Auto-refund (PAID orders only) -----
  // canAutoRefund is the single gate: payment_status==='paid' AND a real
  // 'pay_' payment id AND no refund already in flight. COD/unpaid orders can
  // NEVER pass it, so no money is ever sent for them.
  let refundOutcome: "none" | "processing" | "failed" = "none";
  if (canAutoRefund(order)) {
    // Compare-and-swap: exactly one caller can flip refund_status null→
    // 'processing'. This is the authoritative double-refund guard, independent
    // of any Razorpay-side idempotency. If we don't win it, someone already
    // reserved the refund — do nothing.
    const { data: reserved, error: reserveErr } = await supabaseAdmin
      .from("orders")
      .update({ refund_status: "processing" })
      .eq("id", orderId)
      .is("refund_status", null)
      .is("refund_id", null)
      .select("id")
      .maybeSingle();
    if (reserveErr) {
      // The reserve write itself failed (e.g. a DB constraint rejected it). This
      // must NEVER masquerade as "no refund needed" — surface it as a failure so
      // it can be processed manually. The order still stays cancelled.
      refundOutcome = "failed";
      console.error(
        `[mobile/order cancel] REFUND RESERVE FAILED for order ${orderId}: ${reserveErr.message} — manual refund may be needed`,
        { phone: maskPhone(phoneLocal) },
      );
    } else if (reserved) {
      const amountPaise = Math.round(Number(order.total_amount) * 100);
      const result = await issueRazorpayRefund(
        order.razorpay_payment_id as string,
        amountPaise,
        orderId,
      );
      if (result.ok) {
        refundOutcome = "processing";
        // refunded_at stays null until the refund webhook confirms settlement.
        await supabaseAdmin
          .from("orders")
          .update({ refund_id: result.refundId })
          .eq("id", orderId);
      } else {
        // Refund could not be initiated. Keep the order cancelled, flag the
        // failure for manual processing. NEVER silently swallow.
        refundOutcome = "failed";
        await supabaseAdmin
          .from("orders")
          .update({ refund_status: "failed" })
          .eq("id", orderId);
        console.error("[mobile/order cancel] REFUND FAILED — manual action needed", {
          orderId,
          phone: maskPhone(phoneLocal),
          error: result.error,
          code: result.code,
          httpStatus: result.httpStatus,
        });
      }
    }
  }

  console.info("[mobile/order cancel] success", {
    orderId,
    phone: maskPhone(phoneLocal),
    refundOutcome,
  });

  // Confirmation push to the same device that initiated the cancel. Some
  // users will dismiss the in-app success toast immediately, so a system
  // notification gives them a durable receipt.
  notifyCustomer(
    customer.id,
    "Order cancelled",
    "Your order has been cancelled.",
    { kind: "order_status", order_id: orderId, status: "cancelled" },
  );

  return NextResponse.json({
    ok: true,
    order: updated,
    refund_status: refundOutcome,
    message:
      refundOutcome === "processing"
        ? "Order cancelled. Your refund has been initiated and will reflect in 5-7 business days."
        : refundOutcome === "failed"
        ? "Order cancelled. We hit a snag starting your refund automatically — our team will process it manually."
        : "Order cancelled.",
  });
}
