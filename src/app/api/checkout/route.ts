import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone, normalizePhone } from "@/lib/phone-cookie";
import { generateDeliveries, DAY_KEYS, type DayKey } from "@/lib/subscription-dates";
import {
  DELIVERY_FEE_INR,
  reconcileWebPrices,
  validateWebOrderItemsShape,
  type WebProductRow,
} from "@/lib/order-validation";
import {
  isAcceptableDeliveryDate,
  isAcceptableDeliverySlot,
} from "@/lib/order-delivery";
import { validateBookingSlot } from "@/lib/delivery-slots";
import { normalizePincode, resolveServiceability } from "@/lib/service-areas";

// Server-only admin client. Uses the service role key, which bypasses RLS
// entirely — all writes from this route succeed regardless of table policies.
// SUPABASE_SERVICE_ROLE_KEY must be set in .env.local AND in the Vercel
// Production environment, otherwise this route will throw at request time.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone");
  if (!phone) return NextResponse.json({ customer: null });

  // `slim=1` short-circuits past the full order + subscription history
  // fetch (used by the /orders list page) and returns only what the
  // checkout prefill actually consumes: the customer record + the most
  // recent delivery_address + phone_verified hint. This drops the
  // checkout prefill from ~3s (blocked behind a seq-scan on
  // subscriptions.customer_phone LIKE '%last10') to ~150ms.
  const slim = req.nextUrl.searchParams.get("slim") === "1";

  // Tell the client whether the server already trusts this phone for
  // this request. The web checkout uses this to skip OTP entirely
  // for returning customers whose 30-min `cdx_phone_verified` cookie
  // is still valid for the queried number. Server still re-checks at
  // place_order, so this is a UX hint only — it can't grant trust.
  const verified = getVerifiedPhone(req);
  const phone_verified = !!verified && verified.phone === normalizePhone(phone);

  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id, full_name, phone, city")
    .eq("phone", phone)
    .maybeSingle();

  if (!customer) return NextResponse.json({ customer: null, phone_verified });

  if (slim) {
    // Only the most recent address is needed for prefill. .limit(1) hits
    // the (customer_id, created_at desc) index path and returns immediately.
    const { data: lastOrderRow, error: lastOrderErr } = await supabaseAdmin
      .from("orders")
      .select("delivery_address")
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastOrderErr) console.error("[orders fetch slim]", lastOrderErr.message);

    return NextResponse.json({
      customer: {
        ...customer,
        delivery_address: lastOrderRow?.delivery_address ?? "",
      },
      phone_verified,
    });
  }

  // Full payload (used by /orders list page). Run orders + subscriptions
  // in parallel so the slow subscriptions `LIKE` scan doesn't serialize
  // after orders.
  const last10 = (phone ?? "").replace(/\D/g, "").slice(-10);
  const subOr = [
    `customer_id.eq.${customer.id}`,
    `customer_phone.eq.${phone}`,
    `customer_phone.like.%${last10}`,
  ].join(",");

  const [ordersRes, subsRes] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select("id, total_amount, delivery_address, status, created_at")
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("subscriptions")
      .select(
        "id, product_name, total_amount, status, created_at, customer_address, customer_city",
      )
      .or(subOr)
      .order("created_at", { ascending: false }),
  ]);

  if (ordersRes.error) console.error("[orders fetch]", ordersRes.error.message);
  if (subsRes.error)
    console.error("[subscriptions fetch for orders]", subsRes.error.message);

  const orders = ordersRes.data;
  const subscriptions = subsRes.data;
  const lastOrder = orders?.[0];

  return NextResponse.json({
    customer: { ...customer, delivery_address: lastOrder?.delivery_address ?? "" },
    orders: orders ?? [],
    subscriptions: subscriptions ?? [],
    phone_verified,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  if (body.action === "save_customer") {
    const { full_name, phone, delivery_address, city } = body;
    if (!phone || !full_name || !delivery_address) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const { data: existing } = await supabaseAdmin
      .from("customers")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    let customerId: string;
    if (existing) {
      const { error: updateErr } = await supabaseAdmin
        .from("customers")
        .update({ full_name, city })
        .eq("id", existing.id);
      if (updateErr) {
        console.error("❌ Customer update failed:", updateErr);
        return NextResponse.json(
          { error: "Failed to update customer", details: updateErr.message },
          { status: 500 }
        );
      }
      customerId = existing.id;
    } else {
      const { data: newCust, error } = await supabaseAdmin
        .from("customers")
        .insert({ full_name, phone, city })
        .select("id")
        .single();
      if (error) {
        console.error("❌ Customer insert failed:", error);
        return NextResponse.json(
          { error: "Failed to create customer", details: error.message },
          { status: 500 }
        );
      }
      customerId = newCust.id;
    }

    return NextResponse.json({
      customer: { id: customerId, full_name, phone, city, delivery_address },
    });
  }

  if (body.action === "place_order") {
    const { customer_id, delivery_address, total_amount } = body;
    if (!delivery_address || total_amount === undefined || total_amount === null) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Delivery date + slot are now required for one-shot orders.
    // The customer picks tomorrow / day-after IST and one of 14 hourly
    // slots in the checkout modal.
    const deliveryDate =
      typeof body.delivery_date === "string" ? body.delivery_date : "";
    const deliverySlot =
      typeof body.delivery_slot === "string" ? body.delivery_slot : "";
    if (!isAcceptableDeliveryDate(deliveryDate)) {
      return NextResponse.json(
        { error: "Please pick a delivery date with at least one bookable slot." },
        { status: 400 },
      );
    }
    if (!isAcceptableDeliverySlot(deliverySlot)) {
      return NextResponse.json(
        { error: "Please pick a delivery time slot." },
        { status: 400 },
      );
    }
    // 12 h 10 m booking lead — server-side source of truth.
    // The client greys disabled slots; this is the gate that actually
    // refuses the order when a tampered or stale slot slips through.
    const slotGate = validateBookingSlot(deliveryDate, deliverySlot);
    if (slotGate) {
      return NextResponse.json(
        { error: slotGate.error, code: slotGate.code },
        { status: slotGate.status },
      );
    }

    // Re-check serviceability server-side. The client gates the CTA but
    // a determined attacker could submit anyway.
    const pinFromAddress = typeof body.pincode === "string"
      ? normalizePincode(body.pincode)
      : (delivery_address.match(/(\d{6})\s*$/)?.[1] ?? null);
    if (!pinFromAddress) {
      return NextResponse.json(
        { error: "Invalid pincode." },
        { status: 400 },
      );
    }
    const serviceability = await resolveServiceability(pinFromAddress);
    if (!serviceability.serviceable) {
      return NextResponse.json(
        {
          error: "We don't deliver to this pincode yet. Send us a request and we'll get in touch.",
          code: "pincode_unserviceable",
        },
        { status: 400 },
      );
    }
    // ITEM 4: when the pincode was auto-approved via proximity (not an
    // exact match), drop an "area suggestion" into delivery_requests so
    // admin can one-click promote it to an Areas We Serve entry.
    const proximityHint =
      serviceability.via === "proximity" ? serviceability : null;

    // Server-side OTP enforcement: cookie OR mobile bearer token must be
    // present, valid, unexpired, and its phone must match the customer's
    // stored phone.
    const verified = getVerifiedPhone(req);
    if (!verified) {
      return NextResponse.json(
        { error: "Phone verification required." },
        { status: 401 }
      );
    }

    if (!customer_id) {
      return NextResponse.json({ error: "Missing customer." }, { status: 400 });
    }

    // Validate items shape — the client must declare what's in the cart so
    // we can re-derive prices from the products table. Never trust the
    // client-supplied total_amount.
    const itemsShape = validateWebOrderItemsShape(body.items);
    if (!itemsShape.ok) {
      return NextResponse.json(
        { error: itemsShape.error, code: itemsShape.code },
        { status: itemsShape.status }
      );
    }

    // Fetch authoritative product rows for every slug in the cart.
    const slugs = Array.from(new Set(itemsShape.items.map((i) => i.slug)));
    const { data: productRows, error: productsErr } = await supabaseAdmin
      .from("products")
      .select("slug, name, price_inr, is_active, is_archived, in_stock")
      .in("slug", slugs);
    if (productsErr) {
      console.error("[checkout] products fetch failed:", productsErr);
      return NextResponse.json(
        { error: "Failed to validate cart" },
        { status: 500 }
      );
    }

    const reconciled = reconcileWebPrices(
      itemsShape.items,
      (productRows ?? []) as WebProductRow[],
    );
    if (!reconciled.ok) {
      return NextResponse.json(
        { error: reconciled.error, code: reconciled.code },
        { status: reconciled.status }
      );
    }

    // The client sends its idea of the subtotal in `total_amount` — we
    // compare to the server-computed subtotal and reject any drift.
    const clientSubtotal = Number(total_amount);
    if (!Number.isFinite(clientSubtotal) || clientSubtotal !== reconciled.subtotal) {
      return NextResponse.json(
        {
          error: "Price mismatch — please refresh and retry",
          code: "price_mismatch",
        },
        { status: 400 }
      );
    }

    const deliveryFee = DELIVERY_FEE_INR;
    const grandTotal = reconciled.subtotal + deliveryFee;

    const { data: cust } = await supabaseAdmin
      .from("customers")
      .select("id, phone")
      .eq("id", customer_id)
      .maybeSingle();

    if (!cust || normalizePhone(cust.phone) !== verified.phone) {
      console.warn("⚠️  place_order phone mismatch", {
        customer_id,
        cust_phone: cust?.phone,
        verified_phone: verified.phone,
      });
      return NextResponse.json(
        { error: "Phone verification mismatch." },
        { status: 401 }
      );
    }

    // delivery_date + delivery_slot are now populated by the web
    // checkout (tomorrow / day-after IST + one of 14 hourly slots).
    // The mobile app populates both fields explicitly as well.
    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .insert({
        customer_id,
        total_amount: grandTotal,
        delivery_fee: deliveryFee,
        delivery_address,
        status: "pending",
        items: reconciled.items,
        delivery_date: deliveryDate,
        delivery_slot: deliverySlot,
      })
      .select("id")
      .single();

    if (error) {
      console.error("❌ Order insert failed:", error);
      return NextResponse.json(
        { error: "Failed to create order", details: error.message },
        { status: 500 }
      );
    }

    // Proximity match → log an area suggestion so admin can promote it
    // to a formal Areas We Serve entry. Best-effort; failure here must
    // never roll back the order.
    if (proximityHint) {
      const last10 = normalizePhone(cust.phone)?.replace(/\D/g, "").slice(-10) ?? "";
      void supabaseAdmin
        .from("delivery_requests")
        .insert({
          customer_id,
          phone: last10,
          pincode: pinFromAddress,
          area_name: `Auto: near ${proximityHint.nearest_area} (${proximityHint.distance_km}km)`,
          address: delivery_address,
          status: "pending",
          source: "proximity_order",
        })
        .then(({ error: e }) => {
          if (e) console.warn("[checkout] proximity suggestion failed:", e.message);
        });
    }

    return NextResponse.json({ order_id: order.id, total_amount: grandTotal });
  }

  if (body.action === "place_subscription") {
    const {
      customer_id,
      bread_slug,
      weeks,
      days,
      slot_mode,
      slot,
      slots_by_day,
      total,
      customer_name,
      customer_phone,
      customer_address,
      customer_city,
      customer_pincode,
    } = body;

    if (!customer_id) {
      return NextResponse.json({ error: "Missing customer." }, { status: 400 });
    }
    if (!bread_slug || !weeks || !Array.isArray(days) || days.length === 0) {
      return NextResponse.json({ error: "Invalid subscription payload." }, { status: 400 });
    }

    // Single trust gate: the verified-phone cookie set at the OTP step. Both
    // "saved" (returning customer reusing an existing address row) and "new"
    // (fresh address just OTP-verified this session) flow through the same
    // wizard step that requires OTP — Turnstile already gated /api/verify/send
    // there, so by the time we get here, the cookie is the security control.
    // The phone-match check below applies to both paths so a verified cookie
    // can't be paired with someone else's customer_id.
    const verified = getVerifiedPhone(req);
    if (!verified) {
      return NextResponse.json(
        { error: "Phone verification required." },
        { status: 401 }
      );
    }
    const verifiedPhone = verified.phone;

    const { data: cust } = await supabaseAdmin
      .from("customers")
      .select("id, phone")
      .eq("id", customer_id)
      .maybeSingle();

    if (!cust) {
      return NextResponse.json({ error: "Saved address not found." }, { status: 400 });
    }

    if (normalizePhone(cust.phone) !== verifiedPhone) {
      return NextResponse.json(
        { error: "Phone verification mismatch." },
        { status: 401 }
      );
    }

    const dayKeys = (days as string[])
      .map((d) => d.toLowerCase())
      .filter((d): d is DayKey => (DAY_KEYS as readonly string[]).includes(d));
    if (dayKeys.length === 0) {
      return NextResponse.json({ error: "No valid delivery days." }, { status: 400 });
    }

    // Build the new-tracking-model address blob (jsonb) from the legacy flat fields.
    const deliveryAddressJson = {
      name: customer_name ?? null,
      phone: customer_phone ?? null,
      line1: customer_address ?? null,
      line2: null,
      city: customer_city ?? null,
      pincode: customer_pincode ?? null,
    };

    const qtyPerDelivery = Number(body.quantity_per_delivery) > 0
      ? Number(body.quantity_per_delivery)
      : 1;
    const frequency = body.frequency === "bi-weekly" ? "bi-weekly" : "weekly";

    // The new /subscriptions/setup wizard sends an explicit per-delivery list
    // and wants the parent row to start in pending_confirmation; the legacy
    // /subscription wizard does not, so default to "active" for back-compat.
    const subStatus = body.status === "pending_confirmation" ? "pending_confirmation" : "active";
    const paymentMethod = body.payment_method === "cod" ? "cod" : null;

    // Compute the per-delivery template up front so we can derive an
    // authoritative delivery count for server-side price validation. The
    // exact same template is reused after insert — bread_slug + qty +
    // deliveryCount are the only inputs that determine the grand total.
    type ClientDelivery = {
      sequence: number;
      week_number: number;
      day_key: string;
      delivery_date: string;
      slot: string | null;
      skipped: boolean;
    };
    type DeliveryTemplate = {
      sequence: number;
      week_number: number;
      day_key: string;
      slot: string | null;
      delivery_date: string;
      status: string;
      scheduled_date: string;
      scheduled_time_slot: string | null;
    };
    const clientDeliveries = Array.isArray(body.deliveries)
      ? (body.deliveries as ClientDelivery[]).filter((d) => d && !d.skipped)
      : null;

    let deliveryTemplate: DeliveryTemplate[];
    if (clientDeliveries && clientDeliveries.length > 0) {
      deliveryTemplate = clientDeliveries
        .sort((a, b) => a.delivery_date.localeCompare(b.delivery_date))
        .map((d, i) => ({
          sequence: i + 1,
          week_number: Number(d.week_number) || 1,
          day_key: String(d.day_key).toLowerCase(),
          slot: d.slot ?? null,
          delivery_date: d.delivery_date,
          status: "pending_confirmation",
          scheduled_date: d.delivery_date,
          scheduled_time_slot: d.slot ?? null,
        }));
    } else {
      const generated = generateDeliveries(new Date(), dayKeys, Number(weeks));
      deliveryTemplate = generated.map((d) => {
        const slotForDay =
          slot_mode === "same"
            ? slot
            : (slots_by_day && (slots_by_day as Record<string, string>)[d.day_key]) ?? null;
        const dateStr = d.delivery_date.toISOString().slice(0, 10);
        return {
          sequence: d.sequence,
          week_number: d.week_number,
          day_key: d.day_key,
          slot: slotForDay,
          delivery_date: dateStr,
          status: "pending_confirmation",
          scheduled_date: dateStr,
          scheduled_time_slot: slotForDay,
        };
      });
    }

    // 12 h 10 m booking lead — applied to the FIRST upcoming delivery
    // only. Subsequent weekly deliveries are by definition far enough
    // away to satisfy the rule. Skips when the delivery list is empty
    // (we'll fail below on the count check anyway).
    {
      const firstReal = deliveryTemplate
        .map((d) => ({
          date: d.delivery_date,
          slot: d.slot ?? d.scheduled_time_slot ?? null,
        }))
        .find((d) => !!d.slot);
      if (firstReal && firstReal.slot) {
        const gate = validateBookingSlot(firstReal.date, firstReal.slot);
        if (gate) {
          return NextResponse.json(
            { error: gate.error, code: gate.code },
            { status: gate.status },
          );
        }
      }
    }

    // Server-side price validation. The plan id (bread_slug) is looked up
    // in the products table — the admin editor at /admin/products is now
    // the single source of truth for both the per-loaf subscription price
    // and the product's availability. Client-supplied `total` and
    // `bread_price` are hint-only. Any drift beyond a half-rupee epsilon
    // is rejected with a 400 and audited so we can spot tampering
    // attempts in aggregate.
    //
    // Rejection rules:
    //   - product missing                       → 400 unknown plan
    //   - product is_archived                   → 400 unknown plan
    //   - product is_active=false               → 400 not available
    //   - product in_stock=false                → 400 out of stock
    //   - subscription_per_loaf_inr is null/<=0 → 400 not available
    const planId: string = String(bread_slug);
    const { data: planRow, error: planErr } = await supabaseAdmin
      .from("products")
      .select(
        "slug, name, price_inr, subscription_per_loaf_inr, is_active, in_stock, is_archived",
      )
      .eq("slug", planId)
      .maybeSingle();
    if (planErr) {
      console.error("[checkout] subscription plan lookup failed:", planErr.message);
      return NextResponse.json(
        { error: "Failed to validate subscription" },
        { status: 500 }
      );
    }
    if (!planRow || planRow.is_archived) {
      return NextResponse.json(
        { error: "Unknown subscription plan." },
        { status: 400 }
      );
    }
    if (!planRow.is_active) {
      return NextResponse.json(
        { error: "This subscription is no longer available." },
        { status: 400 }
      );
    }
    if (!planRow.in_stock) {
      return NextResponse.json(
        { error: "This bread is currently out of stock." },
        { status: 400 }
      );
    }
    const pricePerLoaf = Number(
      planRow.subscription_per_loaf_inr ?? planRow.price_inr,
    );
    if (!Number.isFinite(pricePerLoaf) || pricePerLoaf <= 0) {
      return NextResponse.json(
        { error: "Subscription price is not configured for this product." },
        { status: 400 }
      );
    }
    const deliveryCount = deliveryTemplate.length;
    if (!Number.isFinite(qtyPerDelivery) || qtyPerDelivery <= 0 || deliveryCount <= 0) {
      return NextResponse.json(
        { error: "Invalid subscription quantity." },
        { status: 400 }
      );
    }
    const serverAmount = pricePerLoaf * qtyPerDelivery * deliveryCount;
    const plan = { id: planId, name: planRow.name, pricePerLoafInr: pricePerLoaf };
    const clientAmount = Number(body.clientAmount ?? total);
    if (!Number.isFinite(clientAmount) || Math.abs(clientAmount - serverAmount) > 0.5) {
      const phoneForLog = verifiedPhone ?? customer_phone ?? null;
      console.warn(
        `[PRICE_TAMPERING] phone=${phoneForLog} plan=${planId} client=${clientAmount} server=${serverAmount}`
      );
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        null;
      const userAgent = req.headers.get("user-agent") ?? null;
      // Best-effort audit insert — we don't block the response on it.
      void supabaseAdmin
        .from("price_tampering_attempts")
        .insert({
          phone: phoneForLog,
          customer_id: customer_id ?? null,
          context: "subscription",
          plan_id: planId,
          client_amount: Number.isFinite(clientAmount) ? clientAmount : null,
          server_amount: serverAmount,
          ip,
          user_agent: userAgent,
        })
        .then(({ error }) => {
          if (error) {
            console.warn("[PRICE_TAMPERING] audit insert failed:", error.message);
          }
        });
      return NextResponse.json(
        {
          error: "price_mismatch",
          code: "price_mismatch",
          message:
            "The subscription price has changed. Please refresh the page and try again.",
        },
        { status: 400 }
      );
    }

    const { data: sub, error: subErr } = await supabaseAdmin
      .from("subscriptions")
      .insert({
        // Legacy columns — preserved exactly for existing wizard / admin views.
        // bread_price / total are forced to the server-derived figures so a
        // tampered client can never persist a forged amount.
        bread_slug,
        bread_name: plan.name,
        bread_price: plan.pricePerLoafInr,
        weeks,
        days: dayKeys,
        slot_mode,
        slot: slot_mode === "same" ? slot : null,
        slots_by_day: slot_mode === "custom" ? slots_by_day : null,
        total: serverAmount,
        customer_name,
        customer_phone,
        customer_address,
        customer_city,
        customer_pincode,
        status: subStatus,
        // New tracking-model columns — populated for /subscriptions/track + admin.
        customer_id,
        product_slug: bread_slug,
        product_name: plan.name,
        quantity_per_delivery: qtyPerDelivery,
        frequency,
        day_of_week: dayKeys[0] ?? null,
        time_slot: slot_mode === "same" ? slot : (slots_by_day?.[dayKeys[0]] ?? null),
        total_weeks: weeks,
        delivery_address: deliveryAddressJson,
        total_amount: serverAmount,
        payment_status: "pending",
        payment_method: paymentMethod,
      })
      .select("id")
      .single();

    if (subErr || !sub) {
      console.error("❌ Subscription insert failed:", subErr);
      return NextResponse.json(
        { error: "Failed to create subscription", details: subErr?.message },
        { status: 500 }
      );
    }

    // Reuse the per-delivery template computed for price validation —
    // attaching subscription_id is the only remaining step.
    const deliveryRows = deliveryTemplate.map((d) => ({
      subscription_id: sub.id,
      ...d,
    }));

    if (deliveryRows.length > 0) {
      const { error: delErr } = await supabaseAdmin
        .from("subscription_deliveries")
        .insert(deliveryRows);
      if (delErr) {
        console.error("❌ Delivery insert failed:", delErr);
        return NextResponse.json(
          { error: "Failed to create deliveries", details: delErr.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ subscription_id: sub.id, deliveries: deliveryRows.length });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
