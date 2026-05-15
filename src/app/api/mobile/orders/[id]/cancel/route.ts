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
} from "@/lib/order-cancellation";
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
    .select("id, status, created_at")
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

  // ----- 6. Update -----
  // pending_payment orders never received a payment, so there is nothing to
  // refund — leave refund_status null. paid/confirmed orders captured money
  // (Razorpay or COD authorisation) and therefore enter the refund queue.
  const nowIso = new Date().toISOString();
  const requiresRefund = order.status !== "pending_payment";
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("orders")
    .update({
      status: "cancelled",
      cancelled_at: nowIso,
      cancellation_reason: reason,
      refund_status: requiresRefund ? "pending" : null,
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

  console.info("[mobile/order cancel] success", {
    orderId,
    phone: maskPhone(phoneLocal),
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
    message: requiresRefund
      ? "Order cancelled. Refund will be processed within 5-7 business days."
      : "Order cancelled. No payment was captured, so no refund is needed.",
  });
}
