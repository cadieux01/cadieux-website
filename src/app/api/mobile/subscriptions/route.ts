// /api/mobile/subscriptions
// Mobile-equivalent of website's POST /api/checkout (place_subscription action).
//
// Accepts TWO request shapes (discriminated by `mode`):
//
//   mode: 'pattern' (default if omitted — back-compat)
//     { product_id, price_snapshot_inr, weekdays, weeks, start_date,
//       full_name, delivery_address }
//     Generates a recurring schedule via shared `generateDeliveries`.
//
//   mode: 'calendar' (new — mobile-only)
//     { product_id, price_snapshot_inr, deliveries: [{date, time_slot}, ...],
//       full_name, delivery_address }
//     Uses the explicit per-delivery dates and HH:MM times supplied by the
//     mobile calendar picker. `weeks` is stored as 0 to mark calendar mode,
//     `weekdays` is the set of distinct JS-weekday numbers from the picked
//     dates, and `start_date` is the earliest date.
//
// Differences from web:
//  - Bearer-auth (no Turnstile)
//  - Server-side price reconcile (re-fetches product price; client snapshot is hint-only)
//
// Status starts as `pending_confirmation` — same as the website's new
// /subscriptions/setup wizard. Payment integration deferred to a later phase.
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
import { internalJsonHeaders } from "@/lib/internal-secret";
import {
  DAY_KEYS,
  generateDeliveries,
  type DayKey,
} from "@/lib/subscription-dates";
import { subscriptionUnitPrice } from "@/lib/subscription-pricing";
import { getPreorderMode } from "@/lib/preorderMode";
import { BOOKING_LEAD_MINUTES } from "@/lib/delivery-slots";
import {
  MIN_SUBSCRIPTION_DAYS_PER_WEEK,
  MIN_DAYS_ERROR_CODE,
  MIN_DAYS_ERROR_MESSAGE,
} from "@/lib/subscription-min-days";

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

// Calendar mode bounds
const CAL_DELIVERIES_MIN = 1;
const CAL_DELIVERIES_MAX = 50;
const CAL_DAYS_AHEAD_MAX = 90;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Placement gap: slot must be at least BOOKING_LEAD_MINUTES from now
// (bake + ship lead time). NOTE: This is for NEW order placement. The
// edit cutoff (14 h, customer self-edit) is separate and lives in
// /api/mobile/subscriptions/[id]/deliveries/[deliveryId]/edit.
// Derived from the shared constant in @/lib/delivery-slots — do not
// hardcode a second copy here.
const PLACEMENT_GAP_MS = BOOKING_LEAD_MINUTES * 60 * 1000;
// IST is UTC+5:30. Used for IST-aware slot-start calculation.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

type DeliveryAddress = {
  line1: string;
  area: string;
  city: string;
  pincode: string;
};

type SubscriptionPatternBody = {
  mode: "pattern";
  product_id: string;
  price_snapshot_inr: number;
  weekdays: number[];
  weeks: number;
  start_date: string;
  full_name: string;
  delivery_address: DeliveryAddress;
};

type CalendarDelivery = {
  date: string; // yyyy-mm-dd
  time_slot: string; // HH:MM 24h
};

type SubscriptionCalendarBody = {
  mode: "calendar";
  product_id: string;
  price_snapshot_inr: number;
  deliveries: CalendarDelivery[];
  full_name: string;
  delivery_address: DeliveryAddress;
};

type SubscriptionBody = SubscriptionPatternBody | SubscriptionCalendarBody;

type ValidatedShape =
  | {
      ok: true;
      body: SubscriptionBody;
      addressString: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
      code: string;
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

function todayIstMidnight(): Date {
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return new Date(
    istNow.getUTCFullYear(),
    istNow.getUTCMonth(),
    istNow.getUTCDate(),
  );
}

function parseLocalDate(s: string): Date | null {
  const parts = s.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Validates full_name + delivery_address (shared by single-variant and
 * V10 multi-variant paths). Returns the validated parts or a typed failure.
 */
function validateNameAndAddress(r: Record<string, unknown>):
  | {
      ok: true;
      full_name: string;
      delivery_address: DeliveryAddress;
      addressString: string;
    }
  | { ok: false; status: number; error: string; code: string } {
  // full_name
  if (!isString(r.full_name)) {
    return { ok: false, status: 400, error: "full_name is required.", code: "full_name" };
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
    return { ok: false, status: 400, error: `line1 must be ${LINE1_MIN}-${LINE1_MAX} characters.`, code: "line1" };
  }
  if (area.length < AREA_MIN || area.length > AREA_MAX) {
    return { ok: false, status: 400, error: `area must be ${AREA_MIN}-${AREA_MAX} characters.`, code: "area" };
  }
  if (city.length < CITY_MIN || city.length > CITY_MAX) {
    return { ok: false, status: 400, error: `city must be ${CITY_MIN}-${CITY_MAX} characters.`, code: "city" };
  }
  if (!PINCODE_RE.test(pincode)) {
    return { ok: false, status: 400, error: "pincode must be exactly 6 digits.", code: "pincode" };
  }

  return {
    ok: true,
    full_name,
    delivery_address: { line1, area, city, pincode },
    addressString: `${line1}, ${area}, ${city} - ${pincode}`,
  };
}

/**
 * Validates the common fields shared by both modes: product_id,
 * price_snapshot_inr, full_name, delivery_address. Returns either the
 * validated common parts or a typed failure.
 */
function validateCommon(r: Record<string, unknown>):
  | {
      ok: true;
      product_id: string;
      price_snapshot_inr: number;
      full_name: string;
      delivery_address: DeliveryAddress;
      addressString: string;
    }
  | { ok: false; status: number; error: string; code: string } {
  // product_id
  if (!isString(r.product_id) || !r.product_id.trim()) {
    return { ok: false, status: 400, error: "product_id is required.", code: "product_id" };
  }
  const product_id = r.product_id.trim();
  if (product_id.length > 64) {
    return { ok: false, status: 400, error: "product_id is invalid.", code: "product_id" };
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

  const na = validateNameAndAddress(r);
  if (!na.ok) return na;

  return {
    ok: true,
    product_id,
    price_snapshot_inr: r.price_snapshot_inr as number,
    full_name: na.full_name,
    delivery_address: na.delivery_address,
    addressString: na.addressString,
  };
}

function validatePatternShape(
  r: Record<string, unknown>,
  common: {
    product_id: string;
    price_snapshot_inr: number;
    full_name: string;
    delivery_address: DeliveryAddress;
    addressString: string;
  },
): ValidatedShape {
  // weekdays — 1..7 unique integers in 0..6
  if (!Array.isArray(r.weekdays) || r.weekdays.length === 0) {
    return { ok: false, status: 400, error: "Pick at least one delivery day.", code: "weekdays" };
  }
  if (r.weekdays.length > 7) {
    return { ok: false, status: 400, error: "Too many weekdays.", code: "weekdays" };
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

  // Subscription-vs-single-order gate: a subscription must span ≥ N
  // distinct weekdays. Distinct-set size is what matters (0..6 integers
  // already dedupe'd above).
  if (weekdaysSet.size < MIN_SUBSCRIPTION_DAYS_PER_WEEK) {
    return {
      ok: false,
      status: 400,
      error: MIN_DAYS_ERROR_MESSAGE,
      code: MIN_DAYS_ERROR_CODE,
    };
  }

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
  if (!isString(r.start_date) || !DATE_RE.test(r.start_date)) {
    return { ok: false, status: 400, error: "start_date must be yyyy-mm-dd.", code: "start_date" };
  }
  const startDate = parseLocalDate(r.start_date);
  if (!startDate) {
    return { ok: false, status: 400, error: "start_date is not a valid date.", code: "start_date" };
  }
  const todayIst = todayIstMidnight();
  if (startDate.getTime() < todayIst.getTime()) {
    return { ok: false, status: 400, error: "start_date cannot be in the past.", code: "start_date" };
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

  return {
    ok: true,
    body: {
      mode: "pattern",
      product_id: common.product_id,
      price_snapshot_inr: common.price_snapshot_inr,
      weekdays,
      weeks,
      start_date: r.start_date,
      full_name: common.full_name,
      delivery_address: common.delivery_address,
    },
    addressString: common.addressString,
  };
}

/**
 * Validates a `deliveries: [{date, time_slot}]` array (calendar mode).
 * Shared by single-variant calendar mode and the V10 multi-variant path.
 */
function validateCalendarDeliveries(deliveriesRaw: unknown):
  | { ok: true; deliveries: CalendarDelivery[] }
  | { ok: false; status: number; error: string; code: string } {
  if (!Array.isArray(deliveriesRaw) || deliveriesRaw.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Pick at least one delivery date.",
      code: "deliveries",
    };
  }
  if (deliveriesRaw.length < CAL_DELIVERIES_MIN || deliveriesRaw.length > CAL_DELIVERIES_MAX) {
    return {
      ok: false,
      status: 400,
      error: `deliveries count must be ${CAL_DELIVERIES_MIN}-${CAL_DELIVERIES_MAX}.`,
      code: "deliveries",
    };
  }

  const todayIst = todayIstMidnight();
  const maxDate = new Date(todayIst);
  maxDate.setDate(todayIst.getDate() + CAL_DAYS_AHEAD_MAX);

  const seenDates = new Set<string>();
  const parsed: CalendarDelivery[] = [];

  for (let i = 0; i < deliveriesRaw.length; i++) {
    const raw = deliveriesRaw[i] as unknown;
    if (!raw || typeof raw !== "object") {
      return {
        ok: false,
        status: 400,
        error: `deliveries[${i}] is invalid.`,
        code: "deliveries",
      };
    }
    const d = raw as Record<string, unknown>;
    if (!isString(d.date) || !DATE_RE.test(d.date)) {
      return {
        ok: false,
        status: 400,
        error: `deliveries[${i}].date must be yyyy-mm-dd.`,
        code: "deliveries",
      };
    }
    if (!isString(d.time_slot) || !HHMM_RE.test(d.time_slot)) {
      return {
        ok: false,
        status: 400,
        error: `deliveries[${i}].time_slot must be HH:MM (24h).`,
        code: "deliveries",
      };
    }
    const dt = parseLocalDate(d.date);
    if (!dt) {
      return {
        ok: false,
        status: 400,
        error: `deliveries[${i}].date is not a valid date.`,
        code: "deliveries",
      };
    }
    if (dt.getTime() < todayIst.getTime()) {
      return {
        ok: false,
        status: 400,
        error: `deliveries[${i}].date cannot be in the past.`,
        code: "deliveries",
      };
    }
    if (dt.getTime() > maxDate.getTime()) {
      return {
        ok: false,
        status: 400,
        error: `deliveries[${i}].date cannot be more than ${CAL_DAYS_AHEAD_MAX} days out.`,
        code: "deliveries",
      };
    }
    if (seenDates.has(d.date)) {
      return {
        ok: false,
        status: 400,
        error: `Duplicate delivery date: ${d.date}.`,
        code: "deliveries",
      };
    }

    // Placement gap: slot start (IST) must be ≥6 h from now.
    // Parse time_slot 'HH:MM' and compute IST epoch ms for that slot.
    const [slotH, slotM] = (d.time_slot as string).split(":").map(Number);
    const [yyyy, moPart, dayPart] = (d.date as string).split("-").map(Number);
    // IST midnight of the date = UTC midnight - IST_OFFSET_MS
    const istSlotStartMs =
      Date.UTC(yyyy, moPart - 1, dayPart) - IST_OFFSET_MS +
      slotH * 3600_000 + slotM * 60_000;
    if (istSlotStartMs - Date.now() < PLACEMENT_GAP_MS) {
      return {
        ok: false,
        status: 400,
        error: `deliveries[${i}].time_slot is too soon — orders need 6 hours to bake and ship.`,
        code: "slot_too_soon",
      };
    }

    seenDates.add(d.date);
    parsed.push({ date: d.date, time_slot: d.time_slot });
  }

  // Sort by date ascending so storage order is deterministic.
  parsed.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return { ok: true, deliveries: parsed };
}

function validateCalendarShape(
  r: Record<string, unknown>,
  common: {
    product_id: string;
    price_snapshot_inr: number;
    full_name: string;
    delivery_address: DeliveryAddress;
    addressString: string;
  },
): ValidatedShape {
  const dv = validateCalendarDeliveries(r.deliveries);
  if (!dv.ok) return dv;
  const parsed = dv.deliveries;

  return {
    ok: true,
    body: {
      mode: "calendar",
      product_id: common.product_id,
      price_snapshot_inr: common.price_snapshot_inr,
      deliveries: parsed,
      full_name: common.full_name,
      delivery_address: common.delivery_address,
    },
    addressString: common.addressString,
  };
}

function validateShape(raw: unknown): ValidatedShape {
  if (!raw || typeof raw !== "object") {
    return { ok: false, status: 400, error: "Invalid body.", code: "body" };
  }
  const r = raw as Record<string, unknown>;

  const common = validateCommon(r);
  if (!common.ok) return common;

  const mode = isString(r.mode) ? r.mode : "pattern";
  if (mode !== "pattern" && mode !== "calendar") {
    return { ok: false, status: 400, error: "Unsupported mode.", code: "mode" };
  }
  if (mode === "calendar") {
    return validateCalendarShape(r, common);
  }
  return validatePatternShape(r, common);
}

// Disable Next.js route cache so every poll reflects the latest admin writes.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  if (!process.env.MOBILE_APP_KEY) {
    return fail(500, "Server misconfigured");
  }
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return fail(401, "Unauthorized");
  }
  const verified = getVerifiedPhone(req);
  if (!verified) {
    return fail(401, "Phone not verified");
  }
  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) {
    return fail(400, "Verified phone is not in expected format");
  }

  // Look up customer by local 10-digit phone.
  const { data: customer, error: custErr } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (custErr) {
    console.error("[mobile/subscriptions GET] customer lookup:", custErr);
    return fail(500, "Failed to resolve customer");
  }
  if (!customer) {
    return NextResponse.json({ ok: true, active: [], past: [] });
  }

  // All subscriptions for this customer, newest first, capped at 50.
  const { data: subs, error: subsErr } = await supabaseAdmin
    .from("subscriptions")
    .select(
      "id, status, bread_name, product_name, bread_price, total_amount, weeks, days, start_date, created_at, customer_name, customer_address",
    )
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (subsErr) {
    console.error("[mobile/subscriptions GET] subscriptions fetch:", subsErr);
    return fail(500, "Failed to fetch subscriptions");
  }
  if (!subs || subs.length === 0) {
    return NextResponse.json({ ok: true, active: [], past: [] });
  }

  // Next upcoming delivery per subscription (first non-delivered, non-cancelled).
  const ids = subs.map((s) => s.id);
  const { data: deliveries } = await supabaseAdmin
    .from("subscription_deliveries")
    .select("subscription_id, scheduled_date, status")
    .in("subscription_id", ids)
    .not("status", "in", "(delivered,cancelled)")
    .order("scheduled_date", { ascending: true });

  const nextBySub = new Map<string, string | null>();
  for (const d of deliveries ?? []) {
    if (!nextBySub.has(d.subscription_id)) {
      nextBySub.set(d.subscription_id, d.scheduled_date);
    }
  }

  const withNext = subs.map((s) => ({
    ...s,
    next_delivery_date: nextBySub.get(s.id) ?? null,
  }));

  const active = withNext.filter(
    (s) => s.status !== "cancelled" && s.status !== "completed",
  );
  const past = withNext.filter(
    (s) => s.status === "cancelled" || s.status === "completed",
  );

  return NextResponse.json({ ok: true, active, past });
}

type DeliveryRow = {
  subscription_id: string;
  sequence: number;
  week_number: number;
  day_key: DayKey;
  slot: null;
  delivery_date: string;
  status: "pending_confirmation";
  scheduled_date: string;
  scheduled_time_slot: string | null;
};

/**
 * V10 multi-variant subscription placement (calendar mode only).
 * Accepts `items: [{ product_slug, quantity_per_delivery }]` plus the same
 * calendar `deliveries`, name and address as the single-variant path. Each
 * variant is priced server-side via subscriptionUnitPrice (price_inr ×
 * (1 − discount%)); the per-delivery total must be ≥ 2 units across all
 * variants (mirrors the DB trigger). Writes one subscription row (primary
 * variant + blended totals for legacy admin views) plus per-variant
 * subscription_items rows carrying a price snapshot. Auth already checked
 * by the caller; phoneLocal is the verified 10-digit customer phone.
 */
async function handleMultiVariant(
  raw: Record<string, unknown>,
  phoneLocal: string,
): Promise<NextResponse> {
  // Name + address.
  const na = validateNameAndAddress(raw);
  if (!na.ok) return fail(na.status, na.error, na.code);

  // Calendar deliveries.
  const dv = validateCalendarDeliveries(raw.deliveries);
  if (!dv.ok) return fail(dv.status, dv.error, dv.code);
  const deliveries = dv.deliveries;

  // Items: [{ product_slug, quantity_per_delivery }].
  const rawItems = raw.items as Array<{
    product_slug?: unknown;
    quantity_per_delivery?: unknown;
  }>;
  const items = rawItems
    .map((it) => ({
      slug: isString(it.product_slug) ? it.product_slug.trim() : "",
      qty: Number(it.quantity_per_delivery),
    }))
    .filter((it) => it.slug.length > 0 && Number.isFinite(it.qty) && it.qty > 0);
  if (items.length === 0) {
    return fail(400, "No valid subscription items.", "items");
  }

  // Server-side price reconcile per variant.
  const slugs = Array.from(new Set(items.map((i) => i.slug)));
  const { data: rows, error: rowsErr } = await supabaseAdmin
    .from("products")
    .select(
      "slug, name, price_inr, subscription_per_loaf_inr, subscription_discount_pct, is_active, in_stock, is_archived",
    )
    .in("slug", slugs);
  if (rowsErr) {
    console.error("[mobile/subscriptions] multi-variant plan lookup:", rowsErr);
    return fail(500, "Failed to validate subscription");
  }
  const bySlug = new Map((rows ?? []).map((r) => [r.slug as string, r]));

  type SnapItem = {
    product_slug: string;
    product_name: string;
    quantity_per_delivery: number;
    price_snapshot_inr: number;
  };
  const snapItems: SnapItem[] = [];
  let amountPerDelivery = 0;
  let totalUnits = 0;
  for (const it of items) {
    const row = bySlug.get(it.slug);
    if (!row || row.is_archived) {
      return fail(400, "Unknown subscription plan.", "product_unavailable");
    }
    if (!row.is_active) {
      return fail(400, "This subscription is no longer available.", "product_unavailable");
    }
    if (row.in_stock === false) {
      return fail(400, `This bread is currently out of stock: ${row.name}`, "out_of_stock");
    }
    const unit = subscriptionUnitPrice(row);
    if (!Number.isFinite(unit) || unit <= 0) {
      return fail(
        400,
        "Subscription price is not configured for this product.",
        "subscription_unavailable",
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

  // Multi-variant minimum: ≥ 2 units per delivery across all variants.
  if (totalUnits < 2) {
    return fail(
      400,
      "A subscription must include at least 2 units per delivery.",
      "min_units",
    );
  }

  const serverAmount = amountPerDelivery * deliveries.length;

  // Optional client-price cross-check (hint-only; server is authoritative).
  // The app sends price_snapshot_inr = per-delivery amount.
  if (raw.price_snapshot_inr !== undefined && raw.price_snapshot_inr !== null) {
    const clientPerDelivery = Number(raw.price_snapshot_inr);
    if (
      !Number.isFinite(clientPerDelivery) ||
      Math.abs(clientPerDelivery - amountPerDelivery) > 0.5
    ) {
      return fail(
        400,
        "Price mismatch — please refresh and retry.",
        "price_mismatch",
      );
    }
  }

  // Delivery rows from the calendar dates (one row per date).
  const distinctKeys = new Set<DayKey>();
  for (const item of deliveries) {
    const dt = parseLocalDate(item.date);
    if (dt) {
      const key = JS_WEEKDAY_TO_KEY[dt.getDay()];
      if (key) distinctKeys.add(key);
    }
  }
  const daysSorted = Array.from(distinctKeys).sort(
    (a, b) => DAY_KEYS.indexOf(a) - DAY_KEYS.indexOf(b),
  );
  // Multi-variant calendar path: same ≥N-distinct-weekdays rule.
  if (daysSorted.length < MIN_SUBSCRIPTION_DAYS_PER_WEEK) {
    return fail(400, MIN_DAYS_ERROR_MESSAGE, MIN_DAYS_ERROR_CODE);
  }
  const deliveryRowsTemplate: Omit<DeliveryRow, "subscription_id">[] =
    deliveries.map((item, i) => {
      const dt = parseLocalDate(item.date)!;
      const key = JS_WEEKDAY_TO_KEY[dt.getDay()];
      return {
        sequence: i + 1,
        week_number: 1,
        day_key: key,
        slot: null,
        delivery_date: item.date,
        status: "pending_confirmation" as const,
        scheduled_date: item.date,
        scheduled_time_slot: item.time_slot,
      };
    });
  const startDate = deliveries[0].date; // already sorted ascending
  const firstDayKey = daysSorted[0] ?? "mon";

  // Customer upsert by phone.
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (lookupErr) {
    console.error("[mobile/subscriptions] multi customer lookup:", lookupErr);
    return fail(500, "Failed to resolve customer");
  }
  let customerId: string;
  if (existing) {
    const { error: updateErr } = await supabaseAdmin
      .from("customers")
      .update({ full_name: na.full_name, city: na.delivery_address.city })
      .eq("id", existing.id);
    if (updateErr) {
      console.error("[mobile/subscriptions] multi customer update:", updateErr);
      return fail(500, "Failed to update customer");
    }
    customerId = existing.id;
  } else {
    const { data: newCust, error: insertErr } = await supabaseAdmin
      .from("customers")
      .insert({
        full_name: na.full_name,
        phone: phoneLocal,
        city: na.delivery_address.city,
      })
      .select("id")
      .single();
    if (insertErr || !newCust) {
      console.error("[mobile/subscriptions] multi customer insert:", insertErr);
      return fail(500, "Failed to create customer");
    }
    customerId = newCust.id;
  }

  const deliveryAddressJson = {
    name: na.full_name,
    phone: phoneLocal,
    line1: na.delivery_address.line1,
    line2: null,
    city: na.delivery_address.city,
    pincode: na.delivery_address.pincode,
  };

  const primary = snapItems[0];
  const { data: sub, error: subErr } = await supabaseAdmin
    .from("subscriptions")
    .insert({
      // Legacy mirror columns — primary variant + blended totals so old
      // admin views still render. Per-variant truth lives in subscription_items.
      bread_slug: primary.product_slug,
      bread_name: primary.product_name,
      bread_price: primary.price_snapshot_inr,
      weeks: 0, // 0 marks calendar mode
      days: daysSorted,
      slot_mode: "same",
      slot: null,
      slots_by_day: null,
      total: serverAmount,
      customer_name: na.full_name,
      customer_phone: phoneLocal,
      customer_address: na.addressString,
      customer_city: na.delivery_address.city,
      customer_pincode: na.delivery_address.pincode,
      status: "pending_confirmation",
      start_date: startDate,
      customer_id: customerId,
      product_slug: primary.product_slug,
      product_name: primary.product_name,
      quantity_per_delivery: totalUnits,
      frequency: "custom",
      day_of_week: firstDayKey,
      time_slot: null,
      total_weeks: 0,
      delivery_address: deliveryAddressJson,
      total_amount: serverAmount,
      payment_status: "pending",
      payment_method: null,
    })
    .select("id")
    .single();
  if (subErr || !sub) {
    console.error("[mobile/subscriptions] multi subscription insert:", subErr);
    return fail(500, "Failed to create subscription");
  }

  const { error: itemsErr } = await supabaseAdmin
    .from("subscription_items")
    .insert(snapItems.map((s) => ({ subscription_id: sub.id, ...s })));
  if (itemsErr) {
    console.error("[mobile/subscriptions] subscription_items insert:", itemsErr);
    return fail(500, "Failed to create subscription items");
  }

  const deliveryRows: DeliveryRow[] = deliveryRowsTemplate.map((r) => ({
    subscription_id: sub.id,
    ...r,
  }));
  const { error: delErr } = await supabaseAdmin
    .from("subscription_deliveries")
    .insert(deliveryRows);
  if (delErr) {
    console.error("[mobile/subscriptions] multi delivery insert:", delErr);
    return fail(500, "Failed to create deliveries");
  }

  const firstDeliveryDate = deliveryRows[0]?.delivery_date ?? startDate;

  fireAndForget(
    fetch(`${SITE_URL}/api/send-sms`, {
      method: "POST",
      headers: internalJsonHeaders(),
      body: JSON.stringify({
        type: "subscription_placed",
        phone: phoneLocal,
        name: na.full_name,
        subscriptionId: sub.id,
        total: serverAmount,
        deliveries: deliveryRows.length,
        firstDeliveryDate,
      }),
    }),
    "send-sms-sub",
    { phone: phoneLocal },
  );

  const shortId = String(sub.id).slice(0, 8).toUpperCase();
  const waMessage =
    `Hi ${na.full_name || "there"}! 🍞 Your Cadieux subscription has been scheduled.\n\n` +
    `Subscription ID: ${shortId}\n` +
    `${deliveryRows.length} deliveries, first on ${firstDeliveryDate}\n` +
    `Total: ₹${serverAmount}\n` +
    `Delivery to: ${na.addressString}\n\n` +
    `We will confirm your subscription shortly. Thank you for choosing Cadieux!`;
  fireAndForget(
    fetch(`${SITE_URL}/api/send-whatsapp`, {
      method: "POST",
      headers: internalJsonHeaders(),
      body: JSON.stringify({ phone: phoneLocal, message: waMessage }),
    }),
    "send-whatsapp-sub",
    { phone: phoneLocal },
  );

  console.log("[mobile/subscriptions] created (multi-variant)", {
    subscription_id: sub.id,
    items: snapItems.length,
    deliveries: deliveryRows.length,
    total: serverAmount,
  });

  return NextResponse.json({
    ok: true,
    subscription_id: sub.id,
    delivery_count: deliveryRows.length,
    first_delivery_date: firstDeliveryDate,
    total_amount_inr: serverAmount,
  });
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

  // Belt-and-braces pre-order refusal. Web + mobile both block subscription
  // creation while the site-wide toggle is ON — one-time orders still go
  // through (see /api/mobile/checkout + /api/mobile/create-order). The
  // customer-facing pre-order UI on the mobile app is NOT part of this
  // batch, so a legacy build could reach here without a UI gate; this
  // returns a clean error the app can surface as a message.
  if (await getPreorderMode()) {
    return fail(
      409,
      "Subscriptions are paused during pre-order. Place a one-time order today and subscribe when regular delivery resumes.",
      "preorder_mode_active",
    );
  }

  // 4. Parse body. A V10 multi-variant subscription sends `items: [...]`
  //    (calendar mode). Legacy single-variant clients (v8 app) do not — they
  //    fall through to the UNCHANGED pattern/calendar path below.
  const raw = await req.json().catch(() => null);
  const rawItemsList =
    raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).items)
      ? ((raw as Record<string, unknown>).items as unknown[])
      : null;
  if (rawItemsList && rawItemsList.length > 0) {
    return handleMultiVariant(raw as Record<string, unknown>, phoneLocal);
  }

  const shape = validateShape(raw);
  if (!shape.ok) {
    return fail(shape.status, shape.error, shape.code);
  }
  const { body, addressString } = shape;

  // 5. Server-side price reconcile against the products table.
  //    Subscriptions are priced off subscription_per_loaf_inr (set per
  //    product in the admin editor) — fall back to price_inr only when
  //    that column is null so legacy rows still work. Also enforces the
  //    same availability flags as one-time checkout.
  const { data: product, error: productErr } = await supabaseAdmin
    .from("products")
    .select(
      "id, slug, name, price_inr, subscription_per_loaf_inr, subscription_discount_pct, is_active, is_archived, in_stock",
    )
    .eq("id", body.product_id)
    .maybeSingle();

  if (productErr) {
    console.error("[mobile/subscriptions] product fetch failed:", productErr);
    return fail(500, "Failed to validate product");
  }
  if (!product || !product.is_active || product.is_archived === true) {
    return fail(400, `Product unavailable: ${body.product_id}`, "product_unavailable");
  }
  if (product.in_stock === false) {
    return fail(
      400,
      `Product is out of stock: ${product.name}`,
      "out_of_stock",
    );
  }
  // V10 back-compat bridge: the authoritative subscription price is now
  // DERIVED from price_inr × (1 − subscription_discount_pct/100). The v8 app
  // still sends the legacy stored price (subscription_per_loaf_inr ?? price_inr).
  // Accept EITHER so both client generations pass reconcile; persist the
  // derived price as the authoritative value going forward.
  const derivedPrice = subscriptionUnitPrice(product);
  const legacyRaw = product.subscription_per_loaf_inr;
  const legacyPrice =
    legacyRaw !== null && legacyRaw !== undefined
      ? Number(legacyRaw)
      : Number(product.price_inr);
  if (!Number.isFinite(derivedPrice) || derivedPrice <= 0) {
    return fail(
      400,
      "Subscription price is not configured for this product.",
      "subscription_unavailable",
    );
  }
  const clientPrice = Number(body.price_snapshot_inr);
  const EPS = 0.5;
  const matchesDerived = Math.abs(clientPrice - derivedPrice) <= EPS;
  const matchesLegacy =
    Number.isFinite(legacyPrice) &&
    legacyPrice > 0 &&
    Math.abs(clientPrice - legacyPrice) <= EPS;
  if (!matchesDerived && !matchesLegacy) {
    return fail(
      400,
      `Price mismatch: ${body.product_id} — please refresh and retry`,
      "price_mismatch",
    );
  }
  // Persist the authoritative derived price regardless of which the client sent.
  const subPrice = derivedPrice;

  // 6. Compute delivery rows + subscription-level columns based on mode.
  //    For calendar mode the rows are derived directly from the picked
  //    dates+times; for pattern mode we delegate to the shared lib so
  //    web and mobile produce byte-identical pattern schedules.
  let deliveryRowsTemplate: Omit<DeliveryRow, "subscription_id">[];
  let subRowWeeks: number;
  let subRowDays: DayKey[];
  let subRowStartDate: string;
  let subRowFirstDayKey: DayKey;
  let subRowFrequency: string;

  if (body.mode === "pattern") {
    // Map weekdays (JS convention 0=Sun..6=Sat) → 3-letter day_key array.
    const dayKeys: DayKey[] = body.weekdays
      .map((w) => JS_WEEKDAY_TO_KEY[w])
      .filter((d): d is DayKey => Boolean(d));
    if (dayKeys.length === 0) {
      return fail(400, "No valid delivery days.", "weekdays");
    }
    const dayKeysUnique = dayKeys.filter((d, i) => dayKeys.indexOf(d) === i);
    const dayKeysSorted = dayKeysUnique.sort(
      (a, b) => DAY_KEYS.indexOf(a) - DAY_KEYS.indexOf(b),
    );

    // generateDeliveries treats orderDate's weekday as "this week" only if a
    // selected day is strictly LATER in the week. To include start_date itself
    // when it falls on a selected day, anchor at (start_date - 1 day).
    const startParts = body.start_date.split("-").map(Number);
    const anchor = new Date(startParts[0], startParts[1] - 1, startParts[2] - 1);
    const generated = generateDeliveries(anchor, dayKeysSorted, body.weeks);
    if (generated.length === 0) {
      return fail(500, "Failed to generate delivery schedule");
    }

    deliveryRowsTemplate = generated.map((d) => {
      const dateStr = d.delivery_date.toISOString().slice(0, 10);
      return {
        sequence: d.sequence,
        week_number: d.week_number,
        day_key: d.day_key,
        slot: null,
        delivery_date: dateStr,
        status: "pending_confirmation" as const,
        scheduled_date: dateStr,
        scheduled_time_slot: null,
      };
    });
    subRowWeeks = body.weeks;
    subRowDays = dayKeysSorted;
    subRowStartDate = body.start_date;
    subRowFirstDayKey = dayKeysSorted[0];
    subRowFrequency = "weekly";
  } else {
    // Calendar mode — one row per picked date, with explicit HH:MM time.
    // weekdays = distinct JS-weekdays from picked dates (sorted by DAY_KEYS).
    const distinctKeys = new Set<DayKey>();
    for (const item of body.deliveries) {
      const dt = parseLocalDate(item.date);
      if (!dt) {
        return fail(400, "Invalid delivery date.", "deliveries");
      }
      const key = JS_WEEKDAY_TO_KEY[dt.getDay()];
      if (key) distinctKeys.add(key);
    }
    const daysSorted = Array.from(distinctKeys).sort(
      (a, b) => DAY_KEYS.indexOf(a) - DAY_KEYS.indexOf(b),
    );
    // Calendar mode: enforce the same ≥N-distinct-weekdays rule as pattern
    // mode. Multiple dates on the SAME weekday still count as one day.
    if (daysSorted.length < MIN_SUBSCRIPTION_DAYS_PER_WEEK) {
      return fail(400, MIN_DAYS_ERROR_MESSAGE, MIN_DAYS_ERROR_CODE);
    }

    deliveryRowsTemplate = body.deliveries.map((item, i) => {
      const dt = parseLocalDate(item.date)!;
      const key = JS_WEEKDAY_TO_KEY[dt.getDay()];
      return {
        sequence: i + 1,
        week_number: 1,
        day_key: key,
        slot: null,
        delivery_date: item.date,
        status: "pending_confirmation" as const,
        scheduled_date: item.date,
        scheduled_time_slot: item.time_slot,
      };
    });
    // weeks = 0 marks calendar mode.
    subRowWeeks = 0;
    subRowDays = daysSorted;
    subRowStartDate = body.deliveries[0].date; // already sorted ascending
    subRowFirstDayKey = daysSorted[0] ?? "mon";
    subRowFrequency = "custom";
  }

  // 7. Customer upsert by phone (mirrors /api/mobile/checkout).
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

  // 8. Compute totals from server-trusted subscription price.
  const totalAmountInr = subPrice * deliveryRowsTemplate.length;

  // 9. Build the new-tracking-model address blob (jsonb).
  const deliveryAddressJson = {
    name: body.full_name,
    phone: phoneLocal,
    line1: body.delivery_address.line1,
    line2: null,
    city: body.delivery_address.city,
    pincode: body.delivery_address.pincode,
  };

  // 10. Insert subscription row.
  const { data: sub, error: subErr } = await supabaseAdmin
    .from("subscriptions")
    .insert({
      // Legacy columns
      bread_slug: product.slug,
      bread_name: product.name,
      bread_price: subPrice,
      weeks: subRowWeeks,
      days: subRowDays,
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
      start_date: subRowStartDate,
      // New tracking-model columns
      customer_id: customerId,
      product_slug: product.slug,
      product_name: product.name,
      quantity_per_delivery: 1,
      frequency: subRowFrequency,
      day_of_week: subRowFirstDayKey,
      time_slot: null,
      total_weeks: subRowWeeks,
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

  // 11. Insert deliveries.
  const deliveryRows: DeliveryRow[] = deliveryRowsTemplate.map((r) => ({
    subscription_id: sub.id,
    ...r,
  }));

  const { error: delErr } = await supabaseAdmin
    .from("subscription_deliveries")
    .insert(deliveryRows);
  if (delErr) {
    console.error("[mobile/subscriptions] delivery insert failed:", delErr);
    return fail(500, "Failed to create deliveries");
  }

  const firstDeliveryDate = deliveryRows[0]?.delivery_date ?? subRowStartDate;

  // 12. Fire-and-forget SMS + WhatsApp confirmation.
  fireAndForget(
    fetch(`${SITE_URL}/api/send-sms`, {
      method: "POST",
      headers: internalJsonHeaders(),
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
      headers: internalJsonHeaders(),
      body: JSON.stringify({ phone: phoneLocal, message: waMessage }),
    }),
    "send-whatsapp-sub",
    { phone: phoneLocal },
  );

  console.log("[mobile/subscriptions] created", {
    subscription_id: sub.id,
    mode: body.mode,
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
