// /api/mobile/addresses
//
// GET  — list the verified phone's saved addresses (default first, then newest)
// POST — create a new address (rate-limited 10/day per phone)
//
// Auth: X-App-Key + Authorization: Bearer <phone-verified token>.
// All operations are scoped to the bearer's verified phone.
//
// Editing existing addresses is deliberately not supported; customers
// delete + recreate to keep the data model simple.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getVerifiedPhone,
  isValidMobileAppKey,
} from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";
import { addressCreateRateLimit } from "@/lib/ratelimit";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const ADDRESS_COLS = "id, customer_id, label, full_name, line1, area, city, pincode, is_default, created_at";

const LABEL_MAX = 40;
const NAME_MIN = 2;
const NAME_MAX = 80;
const LINE1_MIN = 3;
const LINE1_MAX = 120;
const AREA_MIN = 2;
const AREA_MAX = 80;
const CITY_MIN = 2;
const CITY_MAX = 60;
const PINCODE_RE = /^\d{6}$/;
const MAX_ADDRESSES = 20;

function fail(status: number, error: string, code?: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

function auth(req: NextRequest):
  | { ok: false; res: NextResponse }
  | { ok: true; phoneLocal: string } {
  if (!process.env.MOBILE_APP_KEY) {
    return { ok: false, res: fail(500, "Server misconfigured") };
  }
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return { ok: false, res: fail(401, "Unauthorized") };
  }
  const verified = getVerifiedPhone(req);
  if (!verified) return { ok: false, res: fail(401, "Phone not verified") };
  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) {
    return { ok: false, res: fail(400, "Phone format error") };
  }
  return { ok: true, phoneLocal };
}

/** Look up or create a customer row, returning their id. */
async function resolveCustomer(phoneLocal: string): Promise<string | null> {
  const { data: existing } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (existing) return existing.id;

  // Stub customer — name filled in later when they place their first order.
  const { data: created, error } = await supabaseAdmin
    .from("customers")
    .insert({ phone: phoneLocal, full_name: "" })
    .select("id")
    .single();
  if (error || !created) {
    console.error("[mobile/addresses] customer stub insert failed:", error);
    return null;
  }
  return created.id;
}

// ---------------------------------------------------------------------------
// GET /api/mobile/addresses
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const authResult = auth(req);
  if (!authResult.ok) return authResult.res;
  const { phoneLocal } = authResult;

  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();

  if (!customer) {
    return NextResponse.json({ ok: true, addresses: [] });
  }

  const { data: addresses, error } = await supabaseAdmin
    .from("addresses")
    .select(ADDRESS_COLS)
    .eq("customer_id", customer.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(MAX_ADDRESSES);

  if (error) {
    console.error("[mobile/addresses GET] fetch failed:", error);
    return fail(500, "Failed to fetch addresses");
  }

  return NextResponse.json({ ok: true, addresses: addresses ?? [] });
}

// ---------------------------------------------------------------------------
// POST /api/mobile/addresses
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const authResult = auth(req);
  if (!authResult.ok) return authResult.res;
  const { phoneLocal } = authResult;

  // Rate limit: 10 creates per phone per day.
  const { success: withinLimit } = await addressCreateRateLimit.limit(phoneLocal);
  if (!withinLimit) {
    return fail(429, "Too many address saves today. Try again tomorrow.", "rate_limit");
  }

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return fail(400, "Invalid request body.", "body");
  }
  const body = raw as Record<string, unknown>;

  // Validate label
  const labelRaw = typeof body.label === "string" ? body.label.trim() : "";
  if (!labelRaw || labelRaw.length > LABEL_MAX) {
    return fail(400, `label must be 1-${LABEL_MAX} characters.`, "label");
  }

  // Validate full_name
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  if (fullName.length < NAME_MIN || fullName.length > NAME_MAX) {
    return fail(400, `full_name must be ${NAME_MIN}-${NAME_MAX} characters.`, "full_name");
  }

  // Validate line1
  const line1 = typeof body.line1 === "string" ? body.line1.trim() : "";
  if (line1.length < LINE1_MIN || line1.length > LINE1_MAX) {
    return fail(400, `line1 must be ${LINE1_MIN}-${LINE1_MAX} characters.`, "line1");
  }

  // Validate area
  const area = typeof body.area === "string" ? body.area.trim() : "";
  if (area.length < AREA_MIN || area.length > AREA_MAX) {
    return fail(400, `area must be ${AREA_MIN}-${AREA_MAX} characters.`, "area");
  }

  // Validate city
  const city = typeof body.city === "string" ? body.city.trim() : "";
  if (city.length < CITY_MIN || city.length > CITY_MAX) {
    return fail(400, `city must be ${CITY_MIN}-${CITY_MAX} characters.`, "city");
  }

  // Validate pincode
  const pincode = typeof body.pincode === "string" ? body.pincode.trim() : "";
  if (!PINCODE_RE.test(pincode)) {
    return fail(400, "pincode must be exactly 6 digits.", "pincode");
  }

  const makeDefault = body.make_default === true;

  // Resolve customer (creates stub if first interaction).
  const customerId = await resolveCustomer(phoneLocal);
  if (!customerId) {
    return fail(500, "Failed to resolve customer");
  }

  // Check existing address count.
  const { count, error: countErr } = await supabaseAdmin
    .from("addresses")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId);
  if (countErr) {
    console.error("[mobile/addresses POST] count failed:", countErr);
    return fail(500, "Failed to check address count");
  }

  const existingCount = count ?? 0;

  // First address always becomes the default.
  const setDefault = makeDefault || existingCount === 0;

  if (setDefault && existingCount > 0) {
    // Clear existing defaults before inserting (unique index: one default per customer).
    const { error: clearErr } = await supabaseAdmin
      .from("addresses")
      .update({ is_default: false })
      .eq("customer_id", customerId);
    if (clearErr) {
      console.error("[mobile/addresses POST] clear default failed:", clearErr);
      return fail(500, "Failed to update addresses");
    }
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("addresses")
    .insert({
      customer_id: customerId,
      label: labelRaw,
      full_name: fullName,
      line1,
      area,
      city,
      pincode,
      is_default: setDefault,
    })
    .select(ADDRESS_COLS)
    .single();

  if (insertErr || !inserted) {
    console.error("[mobile/addresses POST] insert failed:", insertErr);
    return fail(500, "Failed to save address");
  }

  return NextResponse.json({ ok: true, address: inserted }, { status: 201 });
}
