import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone, normalizePhone } from "@/lib/phone-cookie";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { generateDeliveries, DAY_KEYS, type DayKey } from "@/lib/subscription-dates";
import {
  DELIVERY_FEE_INR,
  reconcileWebPrices,
  validateWebOrderItemsShape,
  type WebProductRow,
} from "@/lib/order-validation";
import {
  getServerPrice,
  getSubscriptionPlan,
} from "@/lib/subscription-pricing";

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

  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id, full_name, phone, city")
    .eq("phone", phone)
    .maybeSingle();

  if (!customer) return NextResponse.json({ customer: null });

  // One-time orders.
  const { data: orders, error: ordersErr } = await supabaseAdmin
    .from("orders")
    .select("id, total_amount, delivery_address, status, created_at")
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false });

  if (ordersErr) console.error("[orders fetch]", ordersErr.message);

  // Subscription orders, surfaced alongside one-time orders on the user's
  // Orders page. Match by either FK or stored phone for legacy-row safety.
  const last10 = (phone ?? "").replace(/\D/g, "").slice(-10);
  const subOr = [
    `customer_id.eq.${customer.id}`,
    `customer_phone.eq.${phone}`,
    `customer_phone.like.%${last10}`,
  ].join(",");

  const { data: subscriptions, error: subsErr } = await supabaseAdmin
    .from("subscriptions")
    .select("id, product_name, total_amount, status, created_at, customer_address, customer_city")
    .or(subOr)
    .order("created_at", { ascending: false });

  if (subsErr) console.error("[subscriptions fetch for orders]", subsErr.message);

  const lastOrder = orders?.[0];

  return NextResponse.json({
    customer: { ...customer, delivery_address: lastOrder?.delivery_address ?? "" },
    orders: orders ?? [],
    subscriptions: subscriptions ?? [],
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
      .select("slug, name, price_inr, is_active")
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

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .insert({
        customer_id,
        total_amount: grandTotal,
        delivery_fee: deliveryFee,
        delivery_address,
        status: "pending",
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

    console.log("✅ Order created:", { order_id: order.id, customer_id, total_amount: grandTotal });
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

    // Two trust paths:
    //  - "saved" — returning customer reusing a previously-OTP-verified row;
    //    we gate on a fresh Turnstile token + the customer_id existing in DB.
    //  - "new"   — fresh address just OTP-verified this session; we gate on
    //    the OTP cookie matching the customer's phone (legacy behaviour).
    // The client-supplied flag is hint-only — server independently verifies
    // the matching gate before allowing the insert. Gate checks run before
    // any DB lookup so attackers can't probe customer existence without
    // first solving the gate.
    const addressSource: "saved" | "new" = body.address_source === "saved" ? "saved" : "new";

    let verifiedPhone: string | null = null;
    if (addressSource === "saved") {
      const turnstileToken = String(body.turnstile_token ?? "");
      const isHuman = await verifyTurnstileToken(turnstileToken);
      if (!isHuman) {
        return NextResponse.json(
          { error: "Human verification failed. Please try again." },
          { status: 403 }
        );
      }
    } else {
      const verified = getVerifiedPhone(req);
      if (!verified) {
        return NextResponse.json(
          { error: "Phone verification required." },
          { status: 401 }
        );
      }
      verifiedPhone = verified.phone;
    }

    const { data: cust } = await supabaseAdmin
      .from("customers")
      .select("id, phone")
      .eq("id", customer_id)
      .maybeSingle();

    if (!cust) {
      return NextResponse.json({ error: "Saved address not found." }, { status: 400 });
    }

    if (addressSource === "new" && verifiedPhone && normalizePhone(cust.phone) !== verifiedPhone) {
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

    // Server-side price validation. The plan id (bread_slug) maps to a
    // canonical per-loaf price in lib/subscription-pricing.ts — the
    // client-supplied `total` and `bread_price` are hint-only. Any drift
    // beyond a half-rupee epsilon is rejected with a 400 and audited so
    // we can spot tampering attempts in aggregate.
    const planId: string = String(bread_slug);
    const plan = getSubscriptionPlan(planId);
    if (!plan) {
      return NextResponse.json(
        { error: "Unknown subscription plan." },
        { status: 400 }
      );
    }
    const deliveryCount = deliveryTemplate.length;
    const serverAmount = getServerPrice(planId, qtyPerDelivery, deliveryCount);
    if (serverAmount === null) {
      return NextResponse.json(
        { error: "Unknown subscription plan." },
        { status: 400 }
      );
    }
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

    console.log("✅ Subscription created:", { subscription_id: sub.id, deliveries: deliveryRows.length });
    return NextResponse.json({ subscription_id: sub.id, deliveries: deliveryRows.length });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
