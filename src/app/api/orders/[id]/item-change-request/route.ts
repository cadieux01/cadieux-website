// POST /api/orders/[id]/item-change-request
//
// Customer-facing "request a quantity change" for an EXISTING COD order.
// Existing items only — the customer can change the qty (1..99) of lines
// already in the order; they cannot add new products or remove a line
// (min qty 1). The order itself does NOT change here — we record a PENDING
// order_change_requests row (type='items') that an admin later approves or
// rejects. Mirrors the delivery change-request flow.
//
// Owner-scoped (cookie/bearer auth via getVerifiedPhone → customer by phone →
// order scoped to customer_id; 404 on mismatch).
//
// Items are COD-only: the order must be COD, not paid, not cancelled. Only
// kind:"once" lines are editable; kind:"sub" lines are pass-through and may
// not be changed.
//
// MONEY SAFETY: the new subtotal/total are recomputed SERVER-SIDE from the
// order's OWN stored price snapshot (line price_inr * new qty). No client
// total is ever trusted or persisted. delivery_fee is distance-only (never
// item-dependent) so it is carried over unchanged.
//
// Single-pending rule: any existing pending request for this order (ANY type)
// is cancelled first, so there is only ever one pending request per order
// (also DB-enforced by a partial unique index).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

const QTY_MIN = 1;
const QTY_MAX = 99;

type OrderItem = {
  slug?: string;
  name?: string;
  qty?: number;
  kind?: "once" | "sub";
  price_inr?: number;
  line_total?: number;
};

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = (params.id || "").trim();
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
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
    items?: unknown;
    reason?: unknown;
  };
  // Accept either { items: [...] } or a bare array body.
  const rawItems = Array.isArray(body) ? body : body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json(
      { error: "Provide the items to change." },
      { status: 400 },
    );
  }
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : null;

  // Parse + validate the requested {slug, qty} pairs (shape only here).
  const requested = new Map<string, number>();
  for (const it of rawItems as Array<{ slug?: unknown; qty?: unknown }>) {
    const slug = typeof it?.slug === "string" ? it.slug.trim() : "";
    const qty = Number(it?.qty);
    if (!slug) {
      return NextResponse.json({ error: "Invalid item." }, { status: 400 });
    }
    if (!Number.isInteger(qty) || qty < QTY_MIN || qty > QTY_MAX) {
      return NextResponse.json(
        { error: `Quantity must be a whole number between ${QTY_MIN} and ${QTY_MAX}.` },
        { status: 400 },
      );
    }
    requested.set(slug, qty);
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

  // Locate the order, scoped to this customer.
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select(
      "id, customer_id, status, payment_method, payment_status, delivery_fee, items",
    )
    .eq("id", id)
    .maybeSingle();
  if (orderErr) {
    console.error("[orders/item-change-request] order fetch failed:", orderErr.message);
    return NextResponse.json({ error: "Failed to load order" }, { status: 500 });
  }
  if (!order || order.customer_id !== customer.id) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  // Items are COD-only: must be COD, not paid, not cancelled.
  if ((order.payment_method ?? "").toLowerCase() !== "cod") {
    return NextResponse.json(
      { error: "Item changes are only available for Cash on Delivery orders.", code: "not_cod" },
      { status: 409 },
    );
  }
  if ((order.payment_status ?? "").toLowerCase() === "paid") {
    return NextResponse.json(
      { error: "This order is already paid — items can no longer be changed.", code: "already_paid" },
      { status: 409 },
    );
  }
  if ((order.status ?? "").toLowerCase() === "cancelled") {
    return NextResponse.json(
      { error: "This order is cancelled.", code: "cancelled" },
      { status: 409 },
    );
  }

  const orderItems = (order.items ?? []) as OrderItem[];
  // Index editable (once) lines by slug.
  const onceBySlug = new Map<string, OrderItem>();
  for (const it of orderItems) {
    if (it && it.kind !== "sub" && typeof it.slug === "string") {
      onceBySlug.set(it.slug, it);
    }
  }

  // Every requested slug must map to a once-line in the order.
  for (const slug of Array.from(requested.keys())) {
    if (!onceBySlug.has(slug)) {
      return NextResponse.json(
        { error: "You can only change quantities of items already in this order." },
        { status: 400 },
      );
    }
  }

  // Recompute the full items array from the order's OWN price snapshot.
  // For each once-line: new qty = requested ?? current. Sub-lines pass
  // through unchanged. line_total = price_inr * qty (server-authoritative).
  let changed = false;
  let subtotal = 0;
  const requestedItems: { slug: string; qty: number }[] = [];
  const newItems = orderItems.map((it) => {
    if (it && it.kind !== "sub" && typeof it.slug === "string") {
      const curQty = Number(it.qty ?? 0);
      const newQty = requested.has(it.slug) ? (requested.get(it.slug) as number) : curQty;
      const price = Number(it.price_inr ?? 0);
      const lineTotal = price * newQty;
      subtotal += lineTotal;
      requestedItems.push({ slug: it.slug, qty: newQty });
      if (newQty !== curQty) changed = true;
      return { ...it, qty: newQty, line_total: lineTotal };
    }
    // Subscription / unrecognised line — pass through, count its line_total.
    const line =
      typeof it?.line_total === "number"
        ? it.line_total
        : Number(it?.price_inr ?? 0) * Number(it?.qty ?? 0);
    subtotal += line;
    return it;
  });

  if (!changed) {
    return NextResponse.json(
      { error: "Nothing changed — adjust at least one quantity." },
      { status: 400 },
    );
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
    console.error("[orders/item-change-request] insert failed:", insErr?.message);
    return NextResponse.json(
      { error: "Failed to submit request", details: insErr?.message },
      { status: 500 },
    );
  }

  // The freshly-built items are not persisted on the order (admin recomputes
  // again on approve), but we return them + the total so the client can show
  // the post-send summary without trusting its own arithmetic.
  const res = NextResponse.json({
    ok: true,
    request: cr,
    new_total_amount: newTotal,
    new_items: newItems,
  });
  rollPhoneCookieOnWebRequest(req, res);
  return res;
}
