// POST /api/admin/subscriptions/create — manual admin subscription entry.
//
// Admin-only. Phase 3b counterpart to POST /api/admin/orders (one-time).
// Writes the exact same three tables as the public checkout multi-variant
// path (subscriptions + subscription_items + subscription_deliveries) by
// calling the SHARED helpers in src/lib/subscription-checkout.ts, so the
// resulting rows are byte-identical to a customer-placed subscription and
// the tracking page / admin views / mobile app all see them unchanged.
//
// Customer linking: same shape as /api/admin/orders — upsert
// public.customers by 10-digit local phone (customers_phone_unique),
// NEVER overwrite existing name/city, and populate BOTH customer_id AND
// customer_phone on the subscription so /api/subscriptions?phone=... (used
// by the tracking pages) matches on the phone LIKE fallback too.
//
// Admin bypasses:
//   • OTP / phone-verification cookie (admin is the caller)
//   • 12h10m first-delivery booking-lead gate
//   • Serviceability (subscriptions don't gate on pincode/distance today;
//     the flag is accepted for parity with the one-time endpoint but has
//     no serviceability check to skip.)
//
// Server-side pricing (subscriptionUnitPrice), 2-unit minimum, and the
// price-mismatch guard are all still enforced — admin cannot forge a
// forged total any more than a customer can. Prices come from the DB
// products row exclusively.

import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import {
  DAY_KEYS,
  generateDeliveries,
  type DayKey,
} from "@/lib/subscription-dates";
import { subscriptionUnitPrice } from "@/lib/subscription-pricing";
import {
  buildMultiVariantSubscriptionInsert,
  insertMultiVariantSubscription,
  type SubscriptionDeliveryRow,
  type SubscriptionSnapItem,
} from "@/lib/subscription-checkout";

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // 1. Phone + name. Same 10-digit normalization as the one-time path.
  const rawPhone = typeof body.phone === "string" ? body.phone : "";
  const phoneLocal = rawPhone.replace(/\D/g, "").slice(-10);
  if (phoneLocal.length !== 10) {
    return NextResponse.json(
      { error: "Please enter a valid 10-digit phone." },
      { status: 400 },
    );
  }
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  if (!fullName) {
    return NextResponse.json(
      { error: "Customer name is required." },
      { status: 400 },
    );
  }
  const city = typeof body.city === "string" ? body.city.trim() : "";
  const deliveryAddressStr =
    typeof body.delivery_address === "string" ? body.delivery_address.trim() : "";
  if (!deliveryAddressStr) {
    return NextResponse.json(
      { error: "Delivery address is required." },
      { status: 400 },
    );
  }
  const pincode = typeof body.pincode === "string" ? body.pincode.trim() : "";

  // 2. Subscription-shape validation (weeks / days / items).
  const weeks = Number(body.weeks);
  if (!Number.isFinite(weeks) || weeks < 1 || weeks > 26) {
    return NextResponse.json(
      { error: "Weeks must be between 1 and 26." },
      { status: 400 },
    );
  }
  const dayKeys = Array.isArray(body.days)
    ? (body.days as unknown[])
        .map((d) => String(d).toLowerCase())
        .filter((d): d is DayKey => (DAY_KEYS as readonly string[]).includes(d))
    : [];
  if (dayKeys.length === 0) {
    return NextResponse.json(
      { error: "Choose at least one delivery day." },
      { status: 400 },
    );
  }

  const slot = typeof body.slot === "string" ? body.slot : null;
  if (!slot) {
    return NextResponse.json(
      { error: "Choose a delivery time slot." },
      { status: 400 },
    );
  }

  // Multi-variant items only (matches the modern /subscriptions/setup wizard).
  type ItemIn = { product_slug?: string; quantity_per_delivery?: number };
  const rawItems = Array.isArray(body.items) ? (body.items as ItemIn[]) : [];
  const multiItems = rawItems
    .map((it) => ({
      slug: String(it.product_slug ?? "").trim(),
      qty: Number(it.quantity_per_delivery),
    }))
    .filter((it) => it.slug.length > 0 && Number.isFinite(it.qty) && it.qty > 0);
  if (multiItems.length === 0) {
    return NextResponse.json(
      { error: "Add at least one subscription item." },
      { status: 400 },
    );
  }

  // 3. Customer upsert by phone. NEVER overwrite existing name/city.
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("customers")
    .select("id, full_name, city")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (lookupErr) {
    console.error("[admin/subscriptions POST] customer lookup failed:", lookupErr.message);
    return NextResponse.json(
      { error: "Failed to resolve customer" },
      { status: 500 },
    );
  }
  let customerId: string;
  if (existing) {
    const patch: Record<string, string> = {};
    if (!existing.full_name && fullName) patch.full_name = fullName;
    if (!existing.city && city) patch.city = city;
    if (Object.keys(patch).length > 0) {
      const { error: updErr } = await supabaseAdmin
        .from("customers")
        .update(patch)
        .eq("id", existing.id);
      if (updErr) {
        console.error(
          "[admin/subscriptions POST] customer fill failed:",
          updErr.message,
        );
      }
    }
    customerId = existing.id;
  } else {
    const { data: newCust, error: insErr } = await supabaseAdmin
      .from("customers")
      .insert({
        full_name: fullName,
        phone: phoneLocal,
        ...(city ? { city } : {}),
      })
      .select("id")
      .single();
    if (insErr || !newCust) {
      console.error(
        "[admin/subscriptions POST] customer insert failed:",
        insErr?.message,
      );
      return NextResponse.json(
        { error: "Failed to create customer" },
        { status: 500 },
      );
    }
    customerId = newCust.id;
  }

  // 4. Delivery template. Admin bypasses the 12h10m booking-lead gate —
  //    they may be back-dating a walk-in / phone-in subscription that
  //    starts tomorrow. Same generator the checkout uses so schedule
  //    math is identical.
  const generated = generateDeliveries(new Date(), dayKeys, weeks);
  const deliveryTemplate: SubscriptionDeliveryRow[] = generated.map((d) => {
    const dateStr = d.delivery_date.toISOString().slice(0, 10);
    return {
      sequence: d.sequence,
      week_number: d.week_number,
      day_key: d.day_key,
      slot,
      delivery_date: dateStr,
      status: "pending_confirmation",
      scheduled_date: dateStr,
      scheduled_time_slot: slot,
    };
  });
  const deliveryCount = deliveryTemplate.length;
  if (deliveryCount <= 0) {
    return NextResponse.json({ error: "No valid deliveries." }, { status: 400 });
  }

  // 5. Server-side pricing from DB. Prices from products row only —
  //    subscriptionUnitPrice is the shared single source of truth.
  const slugs = Array.from(new Set(multiItems.map((i) => i.slug)));
  const { data: rows, error: rowsErr } = await supabaseAdmin
    .from("products")
    .select(
      "slug, name, price_inr, subscription_per_loaf_inr, subscription_discount_pct, is_active, in_stock, is_archived",
    )
    .in("slug", slugs);
  if (rowsErr) {
    console.error(
      "[admin/subscriptions POST] plan lookup failed:",
      rowsErr.message,
    );
    return NextResponse.json(
      { error: "Failed to validate subscription" },
      { status: 500 },
    );
  }
  const bySlug = new Map((rows ?? []).map((r) => [r.slug as string, r]));

  const snapItems: SubscriptionSnapItem[] = [];
  let amountPerDelivery = 0;
  let totalUnits = 0;
  for (const it of multiItems) {
    const row = bySlug.get(it.slug);
    if (!row || row.is_archived) {
      return NextResponse.json(
        { error: "Unknown subscription plan." },
        { status: 400 },
      );
    }
    if (!row.is_active) {
      return NextResponse.json(
        { error: "This subscription is no longer available." },
        { status: 400 },
      );
    }
    if (!row.in_stock) {
      return NextResponse.json(
        { error: "This bread is currently out of stock." },
        { status: 400 },
      );
    }
    const unit = subscriptionUnitPrice(row);
    if (!Number.isFinite(unit) || unit <= 0) {
      return NextResponse.json(
        { error: "Subscription price is not configured for this product." },
        { status: 400 },
      );
    }
    amountPerDelivery += unit * it.qty;
    totalUnits += it.qty;
    snapItems.push({
      product_slug: row.slug as string,
      product_name: row.name as string,
      quantity_per_delivery: it.qty,
      price_snapshot_inr: unit,
    });
  }

  if (totalUnits < 2) {
    return NextResponse.json(
      {
        error: "A subscription must include at least 2 units per delivery.",
        code: "min_units",
      },
      { status: 400 },
    );
  }

  const serverAmount = amountPerDelivery * deliveryCount;

  // 6. Compose insert row via the SHARED helper. Same column shape as
  //    the public checkout produces — no drift possible.
  const deliveryAddressJson = {
    name: fullName,
    phone: phoneLocal,
    line1: deliveryAddressStr,
    line2: null,
    city: city || null,
    pincode: pincode || null,
  };
  const rawStatus =
    typeof body.status === "string" ? body.status.toLowerCase() : "active";
  const subStatus: "active" | "pending_confirmation" =
    rawStatus === "pending_confirmation" ? "pending_confirmation" : "active";
  const paymentMethod: "cod" | null = body.payment === "paid" ? "cod" : "cod";
  // payment_status is handled inside buildMultiVariantSubscriptionInsert
  // (defaults to 'pending'); once inserted we bump it to 'paid' below if
  // the admin marked cash-collected. Keeps the shared insert path intact.

  const subInsertRow = buildMultiVariantSubscriptionInsert({
    primary: snapItems[0],
    totalUnits,
    weeks,
    dayKeys,
    slot_mode: "same",
    slot,
    slots_by_day: null,
    serverAmount,
    frequency: "weekly",
    customer_id: customerId,
    customer_name: fullName,
    customer_phone: phoneLocal,
    customer_address: deliveryAddressStr,
    customer_city: city || null,
    customer_pincode: pincode || null,
    deliveryAddressJson,
    subStatus,
    paymentMethod,
  });

  const write = await insertMultiVariantSubscription(
    supabaseAdmin,
    subInsertRow,
    snapItems,
    deliveryTemplate,
  );
  if (!write.ok) {
    return NextResponse.json(write.error.body, { status: write.error.status });
  }

  // 7. Optional: mark paid if admin collected cash up-front. Same shape
  //    the one-time admin path uses (paid_at is set, refund gate can't
  //    fire because razorpay_payment_id is absent).
  const isPaid = body.payment === "paid";
  if (isPaid) {
    const { error: payErr } = await supabaseAdmin
      .from("subscriptions")
      .update({ payment_status: "paid" })
      .eq("id", write.subscription_id);
    if (payErr) {
      console.error(
        "[admin/subscriptions POST] mark-paid failed:",
        payErr.message,
      );
    }
  }

  void recordAuditEvent({
    req,
    entity: "subscription",
    action: "create",
    targetId: write.subscription_id,
    targetLabel: `sub ${write.subscription_id.slice(0, 8)}`,
    context: `Admin manually registered subscription for ${phoneLocal}`,
    meta: {
      phone: phoneLocal,
      customer_id: customerId,
      weeks,
      days: dayKeys,
      slot,
      items: snapItems.map((s) => ({
        slug: s.product_slug,
        qty: s.quantity_per_delivery,
      })),
      total_amount: serverAmount,
      deliveries: write.deliveries,
      payment: isPaid ? "paid" : "cod",
      status: subStatus,
    },
  });

  return NextResponse.json({
    ok: true,
    subscription_id: write.subscription_id,
    customer_id: customerId,
    deliveries: write.deliveries,
    items: write.items,
    total_amount: serverAmount,
  });
}
