// /api/mobile/subscriptions
// Mobile-equivalent of website's POST /api/checkout (place_subscription action).
// Differences from web:
//  - Bearer-auth (no Turnstile)
//  - Server-side price reconcile (re-fetches product price; client snapshot is hint-only)
//  - Generates delivery rows via the shared `generateDeliveries` lib so
//    web and mobile produce byte-identical schedules
//
// Status starts as `pending_confirmation` — same as the website's new
// /subscriptions/setup wizard. Payment integration deferred to Phase 8.
//
// MOBILE_APP_KEY is friction-only; bearer is the real gate.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getVerifiedPhone,
  isValidMobileAppKey,
  maskPhone,
} from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";
import {
  DAY_KEYS,
  generateDeliveries,
  type DayKey,
} from "@/lib/subscription-dates";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.cadieux.in";

// Mon..Sun in JS getDay convention (Sun=0..Sat=6) → 3-letter day_key.
// Mobile clients send weekdays in the JS convention.
const JS_WEEKDAY_TO_KEY: Record<number, DayKey> = {
  0: "sun",
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: "sat",
};

const NAME_MIN = 2;
const NAME_MAX = 80;
const LINE1_MIN = 3;
const LINE1_MAX = 120;
const AREA_MIN = 2;
const AREA_MAX = 80;
const CITY_MIN = 2;
const CITY_MAX = 60;
const PINCODE_RE = /^\d{6}$/;
const WEEKS_MIN = 1;
const WEEKS_MAX = 26;
const START_DAYS_AHEAD_MAX = 30;

type DeliveryAddress = {
  line1: string;
  area: string;
  city: string;
  pincode: string;
};

type SubscriptionBody = {
  product_id: string;
  price_snapshot_inr: number;
  weekdays: number[];
  weeks: number;
  start_date: string;
  full_name: string;
  delivery_address: DeliveryAddress;
};

function fail(status: number, error: string, code?: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function validateShape(
  raw: unknown,
):
  | { ok: true; body: SubscriptionBody; addressString: string }
  | { ok: false; status: number; error: string; code: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, status: 400, error: "Invalid body.", code: "body" };
  }
  const r = raw as Record<string, unknown>;

  // product_id
  if (!isString(r.product_id) || !r.product_id.trim()) {
    return {
      ok: false,
      status: 400,
      error: "product_id is required.",
      code: "product_id",
    };
  }
  const product_id = r.product_id.trim();
  if (product_id.length > 64) {
    return {
      ok: false,
      status: 400,
      error: "product_id is invalid.",
      code: "product_id",
    };
  }

  // price_snapshot_inr — reconciled later, just shape-check here.
  if (!isFiniteNumber(r.price_snapshot_inr) || r.price_snapshot_inr < 0) {
    return {
      ok: false,
      status: 400,
      error: "price_snapshot_inr must be a non-negative number.",
      code: "price_snapshot_inr",
    };
  }

  // weekdays — 1..7 unique integers in 0..6
  if (!Array.isArray(r.weekdays) || r.weekdays.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Pick at least one delivery day.",
      code: "weekdays",
    };
  }
  if (r.weekdays.length > 7) {
    return {
      ok: false,
      status: 400,
      error: "Too many weekdays.",
      code: "weekdays",
    };
  }
  const weekdaysSet = new Set<number>();
  for (const w of r.weekdays) {
    if (!Number.isInteger(w) || (w as number) < 0 || (w as number) > 6) {
      return {
        ok: false,
        status: 400,
        error: "weekdays entries must be integers 0-6.",
        code: "weekdays",
      };
    }
    weekdaysSet.add(w as number);
  }
  const weekdays = Array.from(weekdaysSet).sort((a, b) => a - b);

  // weeks — integer 1..26
  if (
    !Number.isInteger(r.weeks) ||
    (r.weeks as number) < WEEKS_MIN ||
    (r.weeks as number) > WEEKS_MAX
  ) {
    return {
      ok: false,
      status: 400,
      error: `weeks must be an integer between ${WEEKS_MIN} and ${WEEKS_MAX}.`,
      code: "weeks",
    };
  }
  const weeks = r.weeks as number;

  // start_date — ISO yyyy-mm-dd, today (IST) or up to 30 days out
  if (!isString(r.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(r.start_date)) {
    return {
      ok: false,
      status: 400,
      error: "start_date must be yyyy-mm-dd.",
      code: "start_date",
    };
  }
  const startParts = r.start_date.split("-").map(Number);
  const startDate = new Date(
    startParts[0],
    startParts[1] - 1,
    startParts[2],
  );
  if (Number.isNaN(startDate.getTime())) {
    return {
      ok: false,
      status: 400,
      error: "start_date is not a valid date.",
      code: "start_date",
    };
  }
  // Compare dates in IST (server may be UTC). Convert "now" to IST y-m-d.
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const todayIst = new Date(
    istNow.getUTCFullYear(),
    istNow.getUTCMonth(),
    istNow.getUTCDate(),
  );
  if (startDate.getTime() < todayIst.getTime()) {
    return {
      ok: false,
      status: 400,
      error: "start_date cannot be in the past.",
      code: "start_date",
    };
  }
  const maxStart = new Date(todayIst);
  maxStart.setDate(todayIst.getDate() + START_DAYS_AHEAD_MAX);
  if (startDate.getTime() > maxStart.getTime()) {
    return {
      ok: false,
      status: 400,
      error: `start_date cannot be more than ${START_DAYS_AHEAD_MAX} days out.`,
      code: "start_date",
    };
  }

  // full_name
  if (!isString(r.full_name)) {
    return {
      ok: false,
      status: 400,
      error: "full_name is required.",
      code: "full_name",
    };
  }
  const full_name = r.full_name.trim();
  if (full_name.length < NAME_MIN || full_name.length > NAME_MAX) {
    return {
      ok: false,
      status: 400,
      error: `full_name must be ${NAME_MIN}-${NAME_MAX} characters.`,
      code: "full_name",
    };
  }

  // delivery_address
  const addr = r.delivery_address;
  if (!addr || typeof addr !== "object") {
    return {
      ok: false,
      status: 400,
      error: "delivery_address is required.",
      code: "delivery_address",
    };
  }
  const a = addr as Record<string, unknown>;
  if (!isString(a.line1) || !isString(a.area) || !isString(a.city) || !isString(a.pincode)) {
    return {
      ok: false,
      status: 400,
      error: "delivery_address fields are required.",
      code: "delivery_address",
    };
  }
  const line1 = a.line1.trim();
  const area = a.area.trim();
  const city = a.city.trim();
  const pincode = a.pincode.trim();
  if (line1.length < LINE1_MIN || line1.length > LINE1_MAX) {
    return {
      ok: false,
      status: 400,
      error: `line1 must be ${LINE1_MIN}-${LINE1_MAX} characters.`,
      code: "line1",
    };
  }
  if (area.length < AREA_MIN || area.length > AREA_MAX) {
    return {
      ok: false,
      status: 400,
      error: `area must be ${AREA_MIN}-${AREA_MAX} characters.`,
      code: "area",
    };
  }
  if (city.length < CITY_MIN || city.length > CITY_MAX) {
    return {
      ok: false,
      status: 400,
      error: `city must be ${CITY_MIN}-${CITY_MAX} characters.`,
      code: "city",
    };
  }
  if (!PINCODE_RE.test(pincode)) {
    return {
      ok: false,
      status: 400,
      error: "pincode must be exactly 6 digits.",
      code: "pincode",
    };
  }

  const addressString = `${line1}, ${area}, ${city} - ${pincode}`;

  return {
    ok: true,
    body: {
      product_id,
      price_snapshot_inr: r.price_snapshot_inr as number,
      weekdays,
      weeks,
      start_date: r.start_date,
      full_name,
      delivery_address: { line1, area, city, pincode },
    },
    addressString,
  };
}

export async function POST(req: NextRequest) {
  // Fail closed if MOBILE_APP_KEY isn't configured.
  if (!process.env.MOBILE_APP_KEY) {
    return fail(500, "Server misconfigured");
  }

  // 1. App-key friction check.
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return fail(401, "Unauthorized");
  }

  // 2. Bearer-token auth.
  const verified = getVerifiedPhone(req);
  if (!verified) {
    return fail(401, "Phone not verified");
  }

  // 3. Strip +91 to local 10-digit form for customers.phone lookup.
  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) {
    return fail(400, "Verified phone is not in expected format");
  }

  // 4. Validate body shape.
  const raw = await req.json().catch(() => null);
  const shape = validateShape(raw);
  if (!shape.ok) {
    return fail(shape.status, shape.error, shape.code);
  }
  const { body, addressString } = shape;

  // 5. Server-side price reconcile against the products table.
  const { data: product, error: productErr } = await supabaseAdmin
    .from("products")
    .select("id, slug, name, price_inr, is_active")
    .eq("id", body.product_id)
    .maybeSingle();

  if (productErr) {
    console.error("[mobile/subscriptions] product fetch failed:", productErr);
    return fail(500, "Failed to validate product");
  }
  if (!product || !product.is_active) {
    return fail(400, `Product unavailable: ${body.product_id}`, "product_unavailable");
  }
  if (product.price_inr !== body.price_snapshot_inr) {
    return fail(
      400,
      `Price mismatch: ${body.product_id} — please refresh and retry`,
      "price_mismatch",
    );
  }

  // 6. Map weekdays (JS convention 0=Sun..6=Sat) → 3-letter day_key array
  //    in the schema's natural order so the deliveries land predictably.
  const dayKeys: DayKey[] = body.weekdays
    .map((w) => JS_WEEKDAY_TO_KEY[w])
    .filter((d): d is DayKey => Boolean(d));
  if (dayKeys.length === 0) {
    return fail(400, "No valid delivery days.", "weekdays");
  }
  // Re-sort by DAY_KEYS order (mon..sun) so generateDeliveries iteration
  // matches the website wizard's day ordering.
  const dayKeysUnique = dayKeys.filter((d, i) => dayKeys.indexOf(d) === i);
  const dayKeysSorted = dayKeysUnique.sort(
    (a, b) => DAY_KEYS.indexOf(a) - DAY_KEYS.indexOf(b),
  );

  // 7. Generate delivery dates from start_date using the shared lib.
  //    Anchor on body.start_date (parsed as local) so the user's chosen
  //    start day appears in week 1 if it's a selected weekday.
  const startParts = body.start_date.split("-").map(Number);
  // generateDeliveries treats orderDate's weekday as "this week" only if a
  // selected day is strictly LATER in the week. To include start_date itself
  // when it falls on a selected day, anchor at (start_date - 1 day).
  const anchor = new Date(startParts[0], startParts[1] - 1, startParts[2] - 1);
  const generated = generateDeliveries(anchor, dayKeysSorted, body.weeks);
  if (generated.length === 0) {
    return fail(500, "Failed to generate delivery schedule");
  }

  // 8. Customer upsert by phone (mirrors /api/mobile/checkout).
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (lookupErr) {
    console.error("[mobile/subscriptions] customer lookup failed:", lookupErr);
    return fail(500, "Failed to resolve customer");
  }

  let customerId: string;
  if (existing) {
    const { error: updateErr } = await supabaseAdmin
      .from("customers")
      .update({ full_name: body.full_name, city: body.delivery_address.city })
      .eq("id", existing.id);
    if (updateErr) {
      console.error("[mobile/subscriptions] customer update failed:", updateErr);
      return fail(500, "Failed to update customer");
    }
    customerId = existing.id;
  } else {
    const { data: newCust, error: insertErr } = await supabaseAdmin
      .from("customers")
      .insert({
        full_name: body.full_name,
        phone: phoneLocal,
        city: body.delivery_address.city,
      })
      .select("id")
      .single();
    if (insertErr || !newCust) {
      console.error("[mobile/subscriptions] customer insert failed:", insertErr);
      return fail(500, "Failed to create customer");
    }
    customerId = newCust.id;
  }

  // 9. Compute totals from server-trusted price.
  const totalAmountInr = product.price_inr * generated.length;

  // 10. Build the new-tracking-model address blob (jsonb) plus the legacy
  //     flat string fields the place_subscription handler also fills.
  const deliveryAddressJson = {
    name: body.full_name,
    phone: phoneLocal,
    line1: body.delivery_address.line1,
    line2: null,
    city: body.delivery_address.city,
    pincode: body.delivery_address.pincode,
  };

  // 11. Insert subscription row. Match the website's place_subscription
  //     handler shape so admin views and /subscriptions/track keep working.
  const firstDayKey = dayKeysSorted[0];
  const { data: sub, error: subErr } = await supabaseAdmin
    .from("subscriptions")
    .insert({
      // Legacy columns
      bread_slug: product.slug,
      bread_name: product.name,
      bread_price: product.price_inr,
      weeks: body.weeks,
      days: dayKeysSorted,
      slot_mode: "same",
      slot: null,
      slots_by_day: null,
      total: totalAmountInr,
      customer_name: body.full_name,
      customer_phone: phoneLocal,
      customer_address: addressString,
      customer_city: body.delivery_address.city,
      customer_pincode: body.delivery_address.pincode,
      status: "pending_confirmation",
      // New tracking-model columns
      customer_id: customerId,
      product_slug: product.slug,
      product_name: product.name,
      quantity_per_delivery: 1,
      frequency: "weekly",
      day_of_week: firstDayKey,
      time_slot: null,
      total_weeks: body.weeks,
      delivery_address: deliveryAddressJson,
      total_amount: totalAmountInr,
      payment_status: "pending",
      payment_method: null,
    })
    .select("id")
    .single();

  if (subErr || !sub) {
    console.error("[mobile/subscriptions] subscription insert failed:", subErr);
    return fail(500, "Failed to create subscription");
  }

  // 12. Insert deliveries — same shape as place_subscription generates.
  const deliveryRows = generated.map((d) => {
    const dateStr = d.delivery_date.toISOString().slice(0, 10);
    return {
      subscription_id: sub.id,
      sequence: d.sequence,
      week_number: d.week_number,
      day_key: d.day_key,
      slot: null,
      delivery_date: dateStr,
      status: "pending_confirmation",
      scheduled_date: dateStr,
      scheduled_time_slot: null,
    };
  });

  const { error: delErr } = await supabaseAdmin
    .from("subscription_deliveries")
    .insert(deliveryRows);
  if (delErr) {
    console.error("[mobile/subscriptions] delivery insert failed:", delErr);
    return fail(500, "Failed to create deliveries");
  }

  const firstDeliveryDate = deliveryRows[0]?.delivery_date ?? body.start_date;

  // 13. Fire-and-forget SMS + WhatsApp confirmation.
  fireAndForget(
    fetch(`${SITE_URL}/api/send-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "subscription_placed",
        phone: phoneLocal,
        name: body.full_name,
        subscriptionId: sub.id,
        total: totalAmountInr,
        deliveries: deliveryRows.length,
        firstDeliveryDate,
      }),
    }),
    "send-sms-sub",
    { phone: phoneLocal },
  );

  const shortId = String(sub.id).slice(0, 8).toUpperCase();
  const waMessage =
    `Hi ${body.full_name || "there"}! 🍞 Your Cadieux subscription has been scheduled.\n\n` +
    `Subscription ID: ${shortId}\n` +
    `${deliveryRows.length} deliveries, first on ${firstDeliveryDate}\n` +
    `Total: ₹${totalAmountInr}\n` +
    `Delivery to: ${addressString}\n\n` +
    `We will confirm your subscription shortly. Thank you for choosing Cadieux!`;
  fireAndForget(
    fetch(`${SITE_URL}/api/send-whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phoneLocal, message: waMessage }),
    }),
    "send-whatsapp-sub",
    { phone: phoneLocal },
  );

  console.log("[mobile/subscriptions] created", {
    subscription_id: sub.id,
    deliveries: deliveryRows.length,
    total: totalAmountInr,
  });

  return NextResponse.json({
    ok: true,
    subscription_id: sub.id,
    delivery_count: deliveryRows.length,
    first_delivery_date: firstDeliveryDate,
    total_amount_inr: totalAmountInr,
  });
}

/**
 * Detaches a fetch from the response lifecycle. Logs both network failures
 * and non-2xx responses (Twilio errors come back as 4xx/5xx, which fetch
 * does not throw on). Phone is masked.
 */
function fireAndForget(
  p: Promise<Response>,
  label: string,
  ctx: { phone: string },
): void {
  p.then(async (res) => {
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string | number;
      };
      console.error(`[mobile/subscriptions] ${label} http_failed`, {
        status: res.status,
        code: data.code,
        error: data.error,
        phone: maskPhone(ctx.phone),
      });
    }
  }).catch((err) => {
    console.error(`[mobile/subscriptions] ${label} threw`, {
      phone: maskPhone(ctx.phone),
      err: String(err),
    });
  });
}
