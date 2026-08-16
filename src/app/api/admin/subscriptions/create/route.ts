// POST /api/admin/subscriptions/create — manual admin subscription entry.
//
// Admin-only. Phase 3b counterpart to POST /api/admin/orders (one-time).
// Writes the exact same three tables as the public checkout multi-variant
// path (subscriptions + subscription_items + subscription_deliveries) by
// calling the SHARED helpers in src/lib/subscription-checkout.ts, so the
// resulting rows are byte-identical to a customer-placed subscription and
// the tracking page / admin views / mobile app all see them unchanged.
//
// Two intake shapes are accepted:
//   1. `deliveries: [{sequence, week_number, day_key, delivery_date, slot}]`
//      — the SAME shape the customer wizard sends from
//      /subscriptions/setup/payment. Preferred; matches the customer
//      flow exactly (per-date scheduling, days can vary week-to-week).
//   2. Legacy uniform-days fallback: {weeks, days:[DayKey], slot} →
//      generateDeliveries(startDate, dayKeys, weeks) with a single slot
//      stamped on every row. Kept for early Phase-3b callers.
//
// The `if (clientDeliveries?.length > 0) use them; else generateDeliveries`
// branch mirrors /api/checkout/route.ts lines 335-372 verbatim so
// admin- and customer-created subscriptions produce identical rows.
//
// Customer linking: same shape as /api/admin/orders — upsert
// public.customers by 10-digit local phone (customers_phone_unique),
// NEVER overwrite existing name/city, and populate BOTH customer_id AND
// customer_phone on the subscription so /api/subscriptions?phone=... (used
// by the tracking pages) matches on the phone LIKE fallback too.
//
// Admin bypasses:
//   • OTP / phone-verification cookie (admin is the caller)
//   • 12h10m first-delivery booking-lead gate (admin may back-date walk-ins)
//   • Serviceability (subscriptions don't gate on pincode/distance today;
//     the flag is accepted for parity with the one-time endpoint but has
//     no serviceability check to skip.)
//
// Server-side pricing (subscriptionUnitPrice), 2-unit minimum, and the
// price-mismatch guard are all still enforced — admin cannot forge a
// forged total any more than a customer can. Prices come from the DB
// products row exclusively.

import { NextRequest, NextResponse } from "next/server";
import {
  isAdmin,
  isTeamOrderToken,
  supabaseAdmin,
  verifyAdminOrTeamOrder,
} from "@/lib/admin-auth";
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

// Client-supplied delivery row shape — mirrors /api/checkout's
// ClientDelivery type (see route.ts:317-324). `slot` may be null when a
// wizard renders slot mode "same" and the parent-row `slot` field carries
// the value, but the admin form always sends a resolved per-date slot.
type ClientDelivery = {
  sequence?: number;
  week_number?: number;
  day_key?: string;
  delivery_date?: string;
  slot?: string | null;
  skipped?: boolean;
};

export async function POST(req: NextRequest) {
  // Dual-auth — see /api/admin/orders POST for the model. Team-order
  // callers are clamped to pending_confirmation + COD below.
  if (!verifyAdminOrTeamOrder(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isTeam = !isAdmin(req) && isTeamOrderToken(req);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Team-PIN clamps — no team member can mark a subscription active
  // (Sunny reviews first) or record cash as collected. Applied before
  // any DB work so a hand-crafted request cannot bypass.
  if (isTeam) {
    body.status = "pending_confirmation";
    body.payment = "cod";
  }

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

  // 2. Client-supplied deliveries[] takes precedence. Same branch
  //    /api/checkout uses (route.ts:335-372) — arbitrary per-date list,
  //    each row already carries its own delivery_date + slot so the
  //    server does not derive from days/weeks. Filters out `skipped`
  //    rows and rows missing required fields.
  const rawDeliveries = Array.isArray(body.deliveries)
    ? (body.deliveries as ClientDelivery[])
    : null;
  const clientDeliveries = rawDeliveries
    ? rawDeliveries.filter(
        (d): d is Required<Pick<ClientDelivery, "delivery_date" | "day_key">> & ClientDelivery =>
          !!d &&
          d.skipped !== true &&
          typeof d.delivery_date === "string" &&
          d.delivery_date.length > 0 &&
          typeof d.day_key === "string" &&
          (DAY_KEYS as readonly string[]).includes(String(d.day_key).toLowerCase()),
      )
    : null;

  // 3. Derive dayKeys + weeks. When deliveries[] is present these come
  //    from the client rows (matching the summary bundle the payment
  //    page builds at payment/page.tsx:86-94). Otherwise fall back to
  //    the legacy uniform-days body fields.
  let dayKeys: DayKey[];
  let weeks: number;
  if (clientDeliveries && clientDeliveries.length > 0) {
    const daySet = new Set<DayKey>();
    const weekSet = new Set<number>();
    for (const d of clientDeliveries) {
      daySet.add(String(d.day_key).toLowerCase() as DayKey);
      weekSet.add(Number(d.week_number) || 1);
    }
    dayKeys = Array.from(daySet);
    weeks = weekSet.size || 1;
  } else {
    const legacyWeeks = Number(body.weeks);
    if (!Number.isFinite(legacyWeeks) || legacyWeeks < 1 || legacyWeeks > 26) {
      return NextResponse.json(
        { error: "Weeks must be between 1 and 26." },
        { status: 400 },
      );
    }
    weeks = legacyWeeks;
    dayKeys = Array.isArray(body.days)
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
  }

  // 4. Slot bundle. Mirrors the checkout route: `slot` used only when
  //    slot_mode === "same"; `slots_by_day` used only when "custom".
  //    The admin form (per-date calendar) always sends "custom" +
  //    slots_by_day; the legacy uniform-days form sends "same" + slot.
  const slotModeIn =
    typeof body.slot_mode === "string" && body.slot_mode.length > 0
      ? body.slot_mode
      : clientDeliveries && clientDeliveries.length > 0
        ? "custom"
        : "same";
  const slotMode = slotModeIn === "custom" ? "custom" : "same";
  const slot = typeof body.slot === "string" && body.slot.length > 0 ? body.slot : null;
  const slotsByDayIn =
    body.slots_by_day && typeof body.slots_by_day === "object"
      ? (body.slots_by_day as Record<string, string>)
      : null;

  // For the legacy fallback path we still require an explicit single slot.
  if (
    (!clientDeliveries || clientDeliveries.length === 0) &&
    slotMode === "same" &&
    !slot
  ) {
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

  // 5. Customer upsert by phone. NEVER overwrite existing name/city.
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

  // 6. Delivery template.
  //    Preferred path — client-supplied per-date list (mirrors
  //    /api/checkout/route.ts:341-352). Rows already carry their own
  //    delivery_date + slot; server sorts by date and re-sequences.
  //    Fallback path — legacy uniform-days generator, one slot stamped
  //    on every row (mirrors route.ts:353-372).
  //
  //    Admin bypasses the 12h10m booking-lead gate in both branches —
  //    they may be back-dating a walk-in / phone-in subscription.
  let deliveryTemplate: SubscriptionDeliveryRow[];
  if (clientDeliveries && clientDeliveries.length > 0) {
    deliveryTemplate = [...clientDeliveries]
      .sort((a, b) =>
        String(a.delivery_date).localeCompare(String(b.delivery_date)),
      )
      .map((d, i) => {
        const dayKey = String(d.day_key).toLowerCase();
        const dateStr = String(d.delivery_date);
        const rowSlot =
          typeof d.slot === "string" && d.slot.length > 0
            ? d.slot
            : slotMode === "same"
              ? slot
              : (slotsByDayIn && slotsByDayIn[dayKey]) ?? null;
        return {
          sequence: i + 1,
          week_number: Number(d.week_number) || 1,
          day_key: dayKey,
          slot: rowSlot,
          delivery_date: dateStr,
          status: "pending_confirmation",
          scheduled_date: dateStr,
          scheduled_time_slot: rowSlot,
        };
      });
  } else {
    const generated = generateDeliveries(new Date(), dayKeys, weeks);
    deliveryTemplate = generated.map((d) => {
      const dateStr = d.delivery_date.toISOString().slice(0, 10);
      const rowSlot =
        slotMode === "same"
          ? slot
          : (slotsByDayIn && slotsByDayIn[d.day_key]) ?? slot ?? null;
      return {
        sequence: d.sequence,
        week_number: d.week_number,
        day_key: d.day_key,
        slot: rowSlot,
        delivery_date: dateStr,
        status: "pending_confirmation",
        scheduled_date: dateStr,
        scheduled_time_slot: rowSlot,
      };
    });
  }

  const deliveryCount = deliveryTemplate.length;
  if (deliveryCount <= 0) {
    return NextResponse.json({ error: "No valid deliveries." }, { status: 400 });
  }

  // 7. Server-side pricing from DB. Prices from products row only —
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

  // 8. Compose insert row via the SHARED helper. Same column shape as
  //    the public checkout produces — no drift possible. slot_mode +
  //    slot + slots_by_day are propagated from the body so the parent
  //    row matches the customer wizard's shape verbatim.
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

  // For the summary parent-row bundle, build slots_by_day from the
  // resolved template when the admin sent "custom" mode without one.
  // Matches payment/page.tsx:91-94 (first-slot-per-day-key wins).
  let slotsByDayOut: Record<string, string> | null = null;
  if (slotMode === "custom") {
    if (slotsByDayIn) {
      slotsByDayOut = slotsByDayIn;
    } else {
      slotsByDayOut = {};
      for (const row of deliveryTemplate) {
        if (row.slot && !slotsByDayOut[row.day_key]) {
          slotsByDayOut[row.day_key] = row.slot;
        }
      }
    }
  }

  const subInsertRow = buildMultiVariantSubscriptionInsert({
    primary: snapItems[0],
    totalUnits,
    weeks,
    dayKeys,
    slot_mode: slotMode,
    slot: slotMode === "same" ? slot : null,
    slots_by_day: slotMode === "custom" ? slotsByDayOut : null,
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

  // 9. Optional: mark paid if admin collected cash up-front. Same shape
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
    context: `${isTeam ? "[team-PIN] " : ""}Admin manually registered subscription for ${phoneLocal}`,
    meta: {
      phone: phoneLocal,
      customer_id: customerId,
      weeks,
      days: dayKeys,
      slot_mode: slotMode,
      slot: slotMode === "same" ? slot : null,
      slots_by_day: slotMode === "custom" ? slotsByDayOut : null,
      items: snapItems.map((s) => ({
        slug: s.product_slug,
        qty: s.quantity_per_delivery,
      })),
      total_amount: serverAmount,
      deliveries: write.deliveries,
      source: clientDeliveries && clientDeliveries.length > 0 ? "per_date" : "uniform",
      payment: isPaid ? "paid" : "cod",
      status: subStatus,
      via: isTeam ? "team_order" : "admin",
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
