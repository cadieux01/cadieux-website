// /api/customer-addresses
//
// Shared address book — same `public.addresses` table the mobile app writes
// to via /api/mobile/addresses. Website surfaces (/account/addresses and
// checkout) and the app now read the same rows for the same customer, keyed
// on the 10-digit phone number (customers.phone).
//
// GET   ?phone=<10-digit>   → list saved addresses, default first
// POST  ?phone=<10-digit>   → create a new address (mobile-parity validation)
//
// Auth model preserved from the previous implementation: phone in the query
// string. The app path uses a bearer token; the web path uses the operator's
// verified phone that /api/checkout already stashes in localStorage. Mirrors
// the mobile POST rules exactly (label 1-40, full_name/line1/area/city length
// bounds, 6-digit pincode, 10-digit phone; duplicate-label guard; max 20 per
// customer; first address auto-defaults).
//
// Field mapping vs the pre-migration schema (`customer_addresses`,
// which was documented but never created in prod):
//   address_line → line1
//   state        → dropped (not in `addresses`)
//   label enum   → free text (mobile side already free text, 40-char cap)
//   full_name    → required
//   phone        → optional on the row, defaults to the caller's phone
//   area         → required
//   latitude/longitude → optional (both-or-neither)
//
// See src/app/api/mobile/addresses/route.ts for the parallel mobile handler.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const ADDRESS_COLS =
  "id, customer_id, label, full_name, phone, line1, area, city, pincode, is_default, created_at, latitude, longitude";

const LABEL_MAX = 40;
const PHONE_DIGITS_RE = /^\d{10}$/;
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

export type CustomerAddress = {
  id: string;
  customer_id: string;
  label: string;
  full_name: string;
  phone: string | null;
  line1: string;
  area: string;
  city: string;
  pincode: string;
  is_default: boolean;
  created_at: string;
  latitude: number | null;
  longitude: number | null;
};

function parseCoord(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "").slice(-10);
}

// GET: list all saved addresses for the caller's phone, default first.
export async function GET(request: NextRequest) {
  const rawPhone = request.nextUrl.searchParams.get("phone");
  if (!rawPhone) {
    return NextResponse.json({ error: "phone required" }, { status: 400 });
  }
  const phone = normalizePhone(rawPhone);
  if (phone.length !== 10) {
    return NextResponse.json({ addresses: [] });
  }

  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (!customer) {
    return NextResponse.json({ addresses: [] });
  }

  const { data: addresses, error } = await supabase
    .from("addresses")
    .select(ADDRESS_COLS)
    .eq("customer_id", customer.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(MAX_ADDRESSES);

  if (error) {
    console.error("[customer-addresses GET] fetch failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch addresses" },
      { status: 500 },
    );
  }

  return NextResponse.json({ addresses: addresses ?? [] });
}

// POST: create a new address. Mobile-parity validation.
export async function POST(request: NextRequest) {
  const rawPhone = request.nextUrl.searchParams.get("phone");
  if (!rawPhone) {
    return NextResponse.json({ error: "phone required" }, { status: 400 });
  }
  const phone = normalizePhone(rawPhone);
  if (phone.length !== 10) {
    return NextResponse.json({ error: "invalid phone" }, { status: 400 });
  }

  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return NextResponse.json(
      { error: "Invalid request body.", code: "body" },
      { status: 400 },
    );
  }
  const body = raw as Record<string, unknown>;

  const labelRaw = typeof body.label === "string" ? body.label.trim() : "";
  if (!labelRaw || labelRaw.length > LABEL_MAX) {
    return NextResponse.json(
      { error: `label must be 1-${LABEL_MAX} characters.`, code: "label" },
      { status: 400 },
    );
  }

  const fullName =
    typeof body.full_name === "string" ? body.full_name.trim() : "";
  if (fullName.length < NAME_MIN || fullName.length > NAME_MAX) {
    return NextResponse.json(
      {
        error: `full_name must be ${NAME_MIN}-${NAME_MAX} characters.`,
        code: "full_name",
      },
      { status: 400 },
    );
  }

  const line1 = typeof body.line1 === "string" ? body.line1.trim() : "";
  if (line1.length < LINE1_MIN || line1.length > LINE1_MAX) {
    return NextResponse.json(
      {
        error: `line1 must be ${LINE1_MIN}-${LINE1_MAX} characters.`,
        code: "line1",
      },
      { status: 400 },
    );
  }

  const area = typeof body.area === "string" ? body.area.trim() : "";
  if (area.length < AREA_MIN || area.length > AREA_MAX) {
    return NextResponse.json(
      {
        error: `area must be ${AREA_MIN}-${AREA_MAX} characters.`,
        code: "area",
      },
      { status: 400 },
    );
  }

  const city = typeof body.city === "string" ? body.city.trim() : "";
  if (city.length < CITY_MIN || city.length > CITY_MAX) {
    return NextResponse.json(
      {
        error: `city must be ${CITY_MIN}-${CITY_MAX} characters.`,
        code: "city",
      },
      { status: 400 },
    );
  }

  const pincode = typeof body.pincode === "string" ? body.pincode.trim() : "";
  if (!PINCODE_RE.test(pincode)) {
    return NextResponse.json(
      { error: "pincode must be exactly 6 digits.", code: "pincode" },
      { status: 400 },
    );
  }

  const phoneRaw = typeof body.phone === "string" ? body.phone.trim() : "";
  const rowPhone = phoneRaw.replace(/^\+91/, "").replace(/\s/g, "");
  if (rowPhone && !PHONE_DIGITS_RE.test(rowPhone)) {
    return NextResponse.json(
      {
        error: "phone must be a valid 10-digit Indian number.",
        code: "phone",
      },
      { status: 400 },
    );
  }
  // Fall back to the caller's verified phone when the body omits it.
  const finalPhone = rowPhone || phone;

  const latitude = parseCoord(body.latitude);
  const longitude = parseCoord(body.longitude);
  const hasCoords = body.latitude != null || body.longitude != null;
  if (hasCoords && (latitude === null || longitude === null)) {
    return NextResponse.json(
      {
        error:
          "latitude and longitude must both be valid numbers when provided.",
        code: "coordinates",
      },
      { status: 400 },
    );
  }

  const makeDefault = body.is_default === true || body.make_default === true;

  // Resolve customer — create a stub if this is a brand-new phone. Matches
  // the mobile POST behaviour so a first-time website customer who saves an
  // address before placing an order still lands in the shared book.
  const { data: existing } = await supabase
    .from("customers")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  let customerId: string | null = existing?.id ?? null;
  if (!customerId) {
    const { data: created, error: stubErr } = await supabase
      .from("customers")
      .insert({ phone, full_name: fullName })
      .select("id")
      .single();
    if (stubErr || !created) {
      console.error("[customer-addresses POST] stub insert failed:", stubErr);
      return NextResponse.json(
        { error: "Failed to resolve customer" },
        { status: 500 },
      );
    }
    customerId = created.id;
  }

  // Duplicate-label guard (case-insensitive), matches mobile.
  const { data: dupeLabel } = await supabase
    .from("addresses")
    .select("id")
    .eq("customer_id", customerId)
    .ilike("label", labelRaw)
    .maybeSingle();
  if (dupeLabel) {
    return NextResponse.json(
      {
        error: `You already have an address labeled "${labelRaw}". Choose a different label.`,
        code: "duplicate_label",
      },
      { status: 400 },
    );
  }

  const { count, error: countErr } = await supabase
    .from("addresses")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId);
  if (countErr) {
    console.error("[customer-addresses POST] count failed:", countErr);
    return NextResponse.json(
      { error: "Failed to check address count" },
      { status: 500 },
    );
  }
  const existingCount = count ?? 0;
  if (existingCount >= MAX_ADDRESSES) {
    return NextResponse.json(
      {
        error: `You've reached the ${MAX_ADDRESSES}-address limit. Delete one to add another.`,
        code: "max_addresses",
      },
      { status: 400 },
    );
  }

  // First address always becomes default.
  const setDefault = makeDefault || existingCount === 0;
  if (setDefault && existingCount > 0) {
    const { error: clearErr } = await supabase
      .from("addresses")
      .update({ is_default: false })
      .eq("customer_id", customerId);
    if (clearErr) {
      console.error("[customer-addresses POST] clear default failed:", clearErr);
      return NextResponse.json(
        { error: "Failed to update addresses" },
        { status: 500 },
      );
    }
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("addresses")
    .insert({
      customer_id: customerId,
      label: labelRaw,
      full_name: fullName,
      phone: finalPhone,
      line1,
      area,
      city,
      pincode,
      is_default: setDefault,
      ...(hasCoords ? { latitude, longitude } : {}),
    })
    .select(ADDRESS_COLS)
    .single();

  if (insertErr || !inserted) {
    if (insertErr?.code === "23505") {
      return NextResponse.json(
        {
          error: `You already have an address labeled "${labelRaw}". Choose a different label.`,
          code: "duplicate_label",
        },
        { status: 400 },
      );
    }
    console.error("[customer-addresses POST] insert failed:", insertErr);
    return NextResponse.json(
      { error: "Failed to save address" },
      { status: 500 },
    );
  }

  return NextResponse.json({ address: inserted }, { status: 201 });
}
