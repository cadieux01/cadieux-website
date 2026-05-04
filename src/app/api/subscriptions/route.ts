import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  PHONE_COOKIE_NAME,
  normalizePhone,
  verifyPhoneCookie,
} from "@/lib/phone-cookie";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { orderRateLimit, getClientIP } from "@/lib/ratelimit";
import {
  DOW_KEYS,
  generateSchedule,
  type DowKey,
  type Frequency,
} from "@/lib/subscription-schedule";
import { PRODUCTS } from "@/lib/data";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ALLOWED_FREQ = new Set<Frequency>(["weekly", "bi-weekly"]);

type AddressShape = {
  line1?: string;
  line2?: string | null;
  city?: string;
  pincode?: string;
  name?: string;
  phone?: string;
};

function isAddressValid(a: unknown): a is AddressShape {
  if (!a || typeof a !== "object") return false;
  const o = a as AddressShape;
  return Boolean(o.line1 && o.city && o.pincode && o.name && o.phone);
}

// -------------------------------------------------------------------------
// GET — list active subscriptions for the verified phone (?phone=...)
// -------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const phoneRaw = req.nextUrl.searchParams.get("phone");
  if (!phoneRaw) return NextResponse.json({ subscriptions: [] });

  const phone = normalizePhone(phoneRaw);
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (!customer) return NextResponse.json({ subscriptions: [] });

  const { data: subs, error } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("customer_id", customer.id)
    .in("status", ["active", "paused"])
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[subscriptions GET]", error.message);
    return NextResponse.json({ subscriptions: [] });
  }

  if (!subs || subs.length === 0) {
    return NextResponse.json({ subscriptions: [] });
  }

  const ids = subs.map((s) => s.id);
  const { data: deliveries } = await supabaseAdmin
    .from("subscription_deliveries")
    .select("subscription_id, scheduled_date, status")
    .in("subscription_id", ids)
    .order("scheduled_date", { ascending: true });

  const nextBySub = new Map<string, string>();
  for (const d of deliveries ?? []) {
    if (d.status === "delivered" || d.status === "cancelled") continue;
    if (!nextBySub.has(d.subscription_id)) {
      nextBySub.set(d.subscription_id, d.scheduled_date);
    }
  }

  return NextResponse.json({
    subscriptions: subs.map((s) => ({
      ...s,
      next_delivery_date: nextBySub.get(s.id) ?? null,
    })),
  });
}

// -------------------------------------------------------------------------
// POST — create a new subscription (replaces legacy `place_subscription`)
// -------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const { success: rlOk } = await orderRateLimit.limit(ip);
  if (!rlOk) {
    return NextResponse.json(
      { error: "Too many orders. Please wait before placing another." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const {
    customer_id,
    product_slug,
    quantity_per_delivery,
    frequency,
    day_of_week,
    time_slot,
    total_weeks,
    delivery_address,
    payment_method,
    turnstileToken,
  } = body ?? {};

  // Bot gate
  const isHuman = await verifyTurnstileToken(String(turnstileToken ?? ""));
  if (!isHuman) {
    return NextResponse.json(
      { error: "Human verification failed. Please try again." },
      { status: 403 }
    );
  }

  // Phone-cookie OTP gate
  const cookieValue = req.cookies.get(PHONE_COOKIE_NAME)?.value;
  const verified = verifyPhoneCookie(cookieValue);
  if (!verified) {
    return NextResponse.json(
      { error: "Phone verification required." },
      { status: 401 }
    );
  }

  if (!customer_id) {
    return NextResponse.json({ error: "Missing customer." }, { status: 400 });
  }
  const product = PRODUCTS.find((p) => p.slug === product_slug);
  if (!product) {
    return NextResponse.json({ error: "Invalid product." }, { status: 400 });
  }
  const qty = Number(quantity_per_delivery);
  if (!Number.isInteger(qty) || qty < 1) {
    return NextResponse.json({ error: "Invalid quantity." }, { status: 400 });
  }
  if (!ALLOWED_FREQ.has(frequency)) {
    return NextResponse.json({ error: "Invalid frequency." }, { status: 400 });
  }
  const dow = String(day_of_week ?? "").toLowerCase();
  if (!(DOW_KEYS as readonly string[]).includes(dow)) {
    return NextResponse.json({ error: "Invalid day_of_week." }, { status: 400 });
  }
  if (!time_slot || typeof time_slot !== "string") {
    return NextResponse.json({ error: "Invalid time_slot." }, { status: 400 });
  }
  const weeks = Number(total_weeks);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
    return NextResponse.json({ error: "Invalid total_weeks." }, { status: 400 });
  }
  if (!isAddressValid(delivery_address)) {
    return NextResponse.json(
      { error: "Invalid delivery_address." },
      { status: 400 }
    );
  }

  // Confirm customer's phone matches the verified cookie phone.
  const { data: cust } = await supabaseAdmin
    .from("customers")
    .select("id, phone")
    .eq("id", customer_id)
    .maybeSingle();
  if (!cust || normalizePhone(cust.phone) !== verified.phone) {
    return NextResponse.json(
      { error: "Phone verification mismatch." },
      { status: 401 }
    );
  }

  const total_amount = Number(product.price) * qty * weeks;

  const { data: sub, error: subErr } = await supabaseAdmin
    .from("subscriptions")
    .insert({
      customer_id,
      product_slug: product.slug,
      product_name: product.name,
      quantity_per_delivery: qty,
      frequency,
      day_of_week: dow,
      time_slot,
      total_weeks: weeks,
      delivery_address,
      total_amount,
      payment_status: "pending",
      payment_method: payment_method ?? "cod",
      status: "active",
    })
    .select("id")
    .single();

  if (subErr || !sub) {
    console.error("[subscriptions POST]", subErr);
    return NextResponse.json(
      { error: "Failed to create subscription", details: subErr?.message },
      { status: 500 }
    );
  }

  const schedule = generateSchedule(
    new Date(),
    dow as DowKey,
    frequency as Frequency,
    weeks
  );
  const rows = schedule.map((s) => ({
    subscription_id: sub.id,
    week_number: s.week_number,
    scheduled_date: s.scheduled_date,
    scheduled_time_slot: time_slot,
    status: "pending_confirmation",
  }));

  if (rows.length > 0) {
    const { error: delErr } = await supabaseAdmin
      .from("subscription_deliveries")
      .insert(rows);
    if (delErr) {
      console.error("[subscription_deliveries insert]", delErr);
      return NextResponse.json(
        { error: "Failed to create deliveries", details: delErr.message },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    subscription_id: sub.id,
    deliveries: rows.length,
    total_amount,
  });
}
