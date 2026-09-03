// /api/customer-addresses/[id]
//
// PATCH  — edit a saved address on the shared `public.addresses` book.
// DELETE — remove one.
//
// Mirrors /api/mobile/addresses/[id] semantics so app + web operate on
// the same rows for the same customer, keyed on customers.phone.
//
// Auth: phone in query string (same model as GET/POST on this handler).
// Ownership: address.customer_id must match the customer resolved from
// the caller's phone. If the deleted row was the default and other
// addresses remain, the most-recently created is promoted.
//
// NOTE: the pre-migration DELETE guard checked `orders.customer_address_id`
// but that column never existed in prod; orders snapshot the address
// into `orders.delivery_address` so hard-deleting the row is safe.

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getVerifiedPhone } from "@/lib/phone-cookie";
import { apiRateLimit, getClientIP } from "@/lib/ratelimit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// The caller must PROVE control of the phone (signed cookie / Bearer),
// not merely type it into the query string, before editing or deleting
// anyone's address. Returns true only when the verified phone matches.
function callerControlsPhone(req: NextRequest, rawPhone: string): boolean {
  const queried10 = rawPhone.replace(/\D/g, "").slice(-10);
  if (queried10.length !== 10) return false;
  const v = getVerifiedPhone(req);
  if (!v) return false;
  return v.phone.replace(/\D/g, "").slice(-10) === queried10;
}

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

function parseCoord(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "").slice(-10);
}

function fail(status: number, error: string, code?: string) {
  return NextResponse.json({ error, code }, { status });
}

async function resolveCustomerId(rawPhone: string | null): Promise<string | null> {
  if (!rawPhone) return null;
  const phone = normalizePhone(rawPhone);
  if (phone.length !== 10) return null;
  const { data } = await supabase
    .from("customers")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  return data?.id ?? null;
}

// PATCH: edit a saved address.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { success: notRateLimited } = await apiRateLimit.limit(
    getClientIP(request),
  );
  if (!notRateLimited) {
    return fail(429, "Rate limit exceeded");
  }

  const { id } = await params;
  if (!id) return fail(400, "Missing address id");

  const rawPhone = request.nextUrl.searchParams.get("phone");
  if (!rawPhone) return fail(400, "phone required");

  if (!callerControlsPhone(request, rawPhone)) {
    return fail(401, "Unauthorized");
  }

  const customerId = await resolveCustomerId(rawPhone);
  if (!customerId) return fail(404, "Address not found or unauthorized");

  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return fail(400, "Invalid request body.", "body");
  }
  const body = raw as Record<string, unknown>;

  // Ownership + baseline row.
  const { data: existing, error: fetchErr } = await supabase
    .from("addresses")
    .select(ADDRESS_COLS)
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) {
    console.error("[customer-addresses PATCH] fetch failed:", fetchErr);
    return fail(500, "Failed to fetch address");
  }
  if (!existing || existing.customer_id !== customerId) {
    return fail(404, "Address not found or unauthorized");
  }

  const patch: Record<string, unknown> = {};

  if (body.label !== undefined) {
    const labelRaw = typeof body.label === "string" ? body.label.trim() : "";
    if (!labelRaw || labelRaw.length > LABEL_MAX) {
      return fail(400, `label must be 1-${LABEL_MAX} characters.`, "label");
    }
    if (labelRaw.toLowerCase() !== String(existing.label).toLowerCase()) {
      const { data: dupe } = await supabase
        .from("addresses")
        .select("id")
        .eq("customer_id", customerId)
        .ilike("label", labelRaw)
        .neq("id", id)
        .maybeSingle();
      if (dupe) {
        return fail(
          400,
          `You already have an address labeled "${labelRaw}". Choose a different label.`,
          "duplicate_label",
        );
      }
    }
    patch.label = labelRaw;
  }

  if (body.full_name !== undefined) {
    const fullName =
      typeof body.full_name === "string" ? body.full_name.trim() : "";
    if (fullName.length < NAME_MIN || fullName.length > NAME_MAX) {
      return fail(
        400,
        `full_name must be ${NAME_MIN}-${NAME_MAX} characters.`,
        "full_name",
      );
    }
    patch.full_name = fullName;
  }

  if (body.line1 !== undefined) {
    const line1 = typeof body.line1 === "string" ? body.line1.trim() : "";
    if (line1.length < LINE1_MIN || line1.length > LINE1_MAX) {
      return fail(
        400,
        `line1 must be ${LINE1_MIN}-${LINE1_MAX} characters.`,
        "line1",
      );
    }
    patch.line1 = line1;
  }

  if (body.area !== undefined) {
    const area = typeof body.area === "string" ? body.area.trim() : "";
    if (area.length < AREA_MIN || area.length > AREA_MAX) {
      return fail(
        400,
        `area must be ${AREA_MIN}-${AREA_MAX} characters.`,
        "area",
      );
    }
    patch.area = area;
  }

  if (body.city !== undefined) {
    const city = typeof body.city === "string" ? body.city.trim() : "";
    if (city.length < CITY_MIN || city.length > CITY_MAX) {
      return fail(
        400,
        `city must be ${CITY_MIN}-${CITY_MAX} characters.`,
        "city",
      );
    }
    patch.city = city;
  }

  if (body.pincode !== undefined) {
    const pincode =
      typeof body.pincode === "string" ? body.pincode.trim() : "";
    if (!PINCODE_RE.test(pincode)) {
      return fail(400, "pincode must be exactly 6 digits.", "pincode");
    }
    patch.pincode = pincode;
  }

  if (body.phone !== undefined) {
    const phoneRaw = typeof body.phone === "string" ? body.phone.trim() : "";
    const phoneDigits = phoneRaw.replace(/^\+91/, "").replace(/\s/g, "");
    if (!PHONE_DIGITS_RE.test(phoneDigits)) {
      return fail(
        400,
        "phone must be a valid 10-digit Indian number.",
        "phone",
      );
    }
    patch.phone = phoneDigits;
  }

  if (body.latitude !== undefined || body.longitude !== undefined) {
    const lat = parseCoord(body.latitude);
    const lng = parseCoord(body.longitude);
    if (lat === null || lng === null) {
      return fail(
        400,
        "latitude and longitude must both be valid numbers when provided.",
        "coordinates",
      );
    }
    patch.latitude = lat;
    patch.longitude = lng;
  }

  const makeDefault = body.is_default === true || body.make_default === true;

  if (Object.keys(patch).length === 0 && !makeDefault) {
    return NextResponse.json({ address: existing });
  }

  // Promote-to-default: clear other defaults first, then flip this row.
  if (makeDefault && !existing.is_default) {
    const { error: clearErr } = await supabase
      .from("addresses")
      .update({ is_default: false })
      .eq("customer_id", customerId);
    if (clearErr) {
      console.error("[customer-addresses PATCH] clear default failed:", clearErr);
      return fail(500, "Failed to update addresses");
    }
    patch.is_default = true;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ address: existing });
  }

  const { data: updated, error: updateErr } = await supabase
    .from("addresses")
    .update(patch)
    .eq("id", id)
    .select(ADDRESS_COLS)
    .single();

  if (updateErr || !updated) {
    if (updateErr?.code === "23505") {
      return fail(
        400,
        "Address label conflict. Pick a different label.",
        "duplicate_label",
      );
    }
    console.error("[customer-addresses PATCH] update failed:", updateErr);
    return fail(500, "Failed to update address");
  }

  return NextResponse.json({ address: updated });
}

// DELETE: remove a saved address. Hard delete — orders snapshot the
// shipping address into orders.delivery_address so no live-order guard
// is needed.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { success: notRateLimited } = await apiRateLimit.limit(
    getClientIP(request),
  );
  if (!notRateLimited) {
    return fail(429, "Rate limit exceeded");
  }

  const { id } = await params;
  if (!id) return fail(400, "Missing address id");

  const rawPhone = request.nextUrl.searchParams.get("phone");
  if (!rawPhone) return fail(400, "phone required");

  if (!callerControlsPhone(request, rawPhone)) {
    return fail(401, "Unauthorized");
  }

  const customerId = await resolveCustomerId(rawPhone);
  if (!customerId) return fail(404, "Address not found or unauthorized");

  const { data: address, error: fetchErr } = await supabase
    .from("addresses")
    .select(ADDRESS_COLS)
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) {
    console.error("[customer-addresses DELETE] fetch failed:", fetchErr);
    return fail(500, "Failed to fetch address");
  }
  if (!address || address.customer_id !== customerId) {
    return fail(404, "Address not found or unauthorized");
  }

  const wasDefault = address.is_default as boolean;

  const { error: delErr } = await supabase
    .from("addresses")
    .delete()
    .eq("id", id);
  if (delErr) {
    console.error("[customer-addresses DELETE] delete failed:", delErr);
    return fail(500, "Failed to delete address");
  }

  if (wasDefault) {
    const { data: remaining } = await supabase
      .from("addresses")
      .select("id")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (remaining && remaining.length > 0) {
      await supabase
        .from("addresses")
        .update({ is_default: true })
        .eq("id", remaining[0].id);
    }
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
