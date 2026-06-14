// POST /api/mobile/orders/[id]/item-change-request
//
// Mobile counterpart of /api/orders/[id]/item-change-request. Same intent
// — let a COD customer request a quantity change on existing order lines,
// pending admin approval — but keyed on the MOBILE item snapshot shape
// { product_id, name, quantity, unit_price_inr, line_total_inr } that the
// app's checkout/create-order persists (the web route keys on slug + kind).
//
// Auth: X-App-Key + bearer (getVerifiedPhone) + owner-by-phone (404 on
// mismatch). Items are COD-only: order must be COD, not paid, not cancelled.
//
// MONEY SAFETY: subtotal is recomputed SERVER-SIDE from the order's OWN
// stored unit_price_inr * new qty; delivery_fee (distance-only) is carried
// over unchanged; total = subtotal + delivery_fee. No client total is ever
// trusted or persisted. requested_items stores [{ product_id, qty }] only.
//
// Single-pending rule: any existing pending request for this order (ANY
// type) is cancelled first, so there is only ever one pending request per
// order (also DB-enforced by a partial unique index).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone, isValidMobileAppKey } from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const QTY_MIN = 1;
const QTY_MAX = 99;

// Mobile item snapshot shape (see reconcile() in order-validation.ts).
type MobileOrderItem = {
  product_id?: string;
  name?: string;
  quantity?: number;
  unit_price_inr?: number;
  line_total_inr?: number;
};

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

  const orderId = (params.id || "").trim();
  if (!orderId) return fail(400, "Bad order id", "bad_id");

  const body = (await req.json().catch(() => ({}))) as {
    items?: unknown;
    reason?: unknown;
  };
  // Accept either { items: [...] } or a bare array body.
  const rawItems = Array.isArray(body) ? body : body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return fail(400, "Provide the items to change.");
  }
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : null;

  // Parse + validate the requested { product_id, qty } pairs (shape only).
  const requested = new Map<string, number>();
  for (const it of rawItems as Array<{ product_id?: unknown; qty?: unknown }>) {
    const productId =
      typeof it?.product_id === "string" ? it.product_id.trim() : "";
    const qty = Number(it?.qty);
    if (!productId) return fail(400, "Invalid item.");
    if (!Number.isInteger(qty) || qty < QTY_MIN || qty > QTY_MAX) {
      return fail(
        400,
        `Quantity must be a whole number between ${QTY_MIN} and ${QTY_MAX}.`,
      );
    }
    requested.set(productId, qty);
  }

  // ----- 2. Customer -----
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (!customer) return fail(404, "Not found");

  // ----- 3. Order (scoped to this customer) -----
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select(
      "id, customer_id, status, payment_method, payment_status, delivery_fee, items",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr) {
    console.error("[mobile/item-change-request] order fetch failed:", orderErr.message);
    return fail(500, "Failed to load order");
  }
  if (!order || order.customer_id !== customer.id) {
    return fail(404, "Order not found.");
  }

  // Items are COD-only: must be COD, not paid, not cancelled.
  if ((order.payment_method ?? "").toLowerCase() !== "cod") {
    return fail(
      409,
      "Item changes are only available for Cash on Delivery orders.",
      "not_cod",
    );
  }
  if ((order.payment_status ?? "").toLowerCase() === "paid") {
    return fail(
      409,
      "This order is already paid — items can no longer be changed.",
      "already_paid",
    );
  }
  if ((order.status ?? "").toLowerCase() === "cancelled") {
    return fail(409, "This order is cancelled.", "cancelled");
  }

  const orderItems = (order.items ?? []) as MobileOrderItem[];
  // Index lines by product_id. Mobile orders contain only one-time lines
  // (subscriptions are a wholly separate flow), so every line is editable.
  const byProductId = new Map<string, MobileOrderItem>();
  for (const it of orderItems) {
    if (it && typeof it.product_id === "string") {
      byProductId.set(it.product_id, it);
    }
  }

  // Every requested product_id must map to a line in the order.
  for (const pid of Array.from(requested.keys())) {
    if (!byProductId.has(pid)) {
      return fail(
        400,
        "You can only change quantities of items already in this order.",
      );
    }
  }

  // Recompute the full items array from the order's OWN price snapshot.
  // For each line: new qty = requested ?? current; line_total_inr =
  // unit_price_inr * qty (server-authoritative).
  let changed = false;
  let subtotal = 0;
  const requestedItems: { product_id: string; qty: number }[] = [];
  const newItems = orderItems.map((it) => {
    if (it && typeof it.product_id === "string") {
      const curQty = Number(it.quantity ?? 0);
      const newQty = requested.has(it.product_id)
        ? (requested.get(it.product_id) as number)
        : curQty;
      const price = Number(it.unit_price_inr ?? 0);
      const lineTotal = price * newQty;
      subtotal += lineTotal;
      requestedItems.push({ product_id: it.product_id, qty: newQty });
      if (newQty !== curQty) changed = true;
      return { ...it, quantity: newQty, line_total_inr: lineTotal };
    }
    // Unrecognised line — pass through, count its line_total_inr.
    const line =
      typeof it?.line_total_inr === "number"
        ? it.line_total_inr
        : Number(it?.unit_price_inr ?? 0) * Number(it?.quantity ?? 0);
    subtotal += line;
    return it;
  });

  if (!changed) {
    return fail(400, "Nothing changed — adjust at least one quantity.");
  }

  const deliveryFee = Number(order.delivery_fee ?? 0);
  const newTotal = subtotal + deliveryFee;

  // Replace: void any existing pending request for this order (any type)
  // first, so the partial-unique index never trips.
  await supabaseAdmin
    .from("order_change_requests")
    .update({ status: "cancelled", resolved_at: new Date().toISOString() })
    .eq("order_id", order.id)
    .eq("status", "pending");

  const { data: cr, error: insErr } = await supabaseAdmin
    .from("order_change_requests")
    .insert({
      order_id: order.id,
      type: "items",
      status: "pending",
      requested_items: requestedItems,
      requested_total_amount: newTotal,
      reason,
    })
    .select("id, status, type, requested_items, requested_total_amount, reason, created_at")
    .single();

  if (insErr || !cr) {
    console.error("[mobile/item-change-request] insert failed:", insErr?.message);
    return fail(500, "Failed to submit request");
  }

  // The freshly-built items are not persisted on the order (admin recomputes
  // again on approve), but we return them + the total so the client can show
  // the post-send summary without trusting its own arithmetic.
  return NextResponse.json({
    ok: true,
    request: cr,
    new_total_amount: newTotal,
    new_items: newItems,
  });
}
