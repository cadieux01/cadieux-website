// /api/mobile/addresses/[id]
//
// PATCH  — edit a saved address (label + recipient + lines).
// DELETE — remove a saved address.
//
// Ownership check: address must belong to the verified phone's customer.
// If deleting the default and other addresses remain, the most-recently
// created non-deleted address is promoted to default.
//
// PATCH accepts the same fields as POST /api/mobile/addresses (label,
// full_name, phone, line1, area, city, pincode, make_default). Only
// keys present in the body are touched. is_default is never set to
// false via PATCH (use a different address's make_default to swap).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getVerifiedPhone,
  isValidMobileAppKey,
} from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const ADDRESS_COLS = "id, customer_id, label, full_name, phone, line1, area, city, pincode, is_default, created_at";

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

// ---------------------------------------------------------------------------
// PATCH /api/mobile/addresses/[id]
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = auth(req);
  if (!authResult.ok) return authResult.res;
  const { phoneLocal } = authResult;

  const { id } = await params;
  if (!id) return fail(400, "Missing address id");

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return fail(400, "Invalid request body.", "body");
  }
  const body = raw as Record<string, unknown>;

  // Resolve customer.
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (!customer) return fail(404, "Address not found");

  // Fetch existing address — ownership check + label-conflict baseline.
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from("addresses")
    .select(ADDRESS_COLS)
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) {
    console.error("[mobile/addresses PATCH] fetch failed:", fetchErr);
    return fail(500, "Failed to fetch address");
  }
  if (!existing || existing.customer_id !== customer.id) {
    return fail(404, "Address not found");
  }

  // Build the update patch, validating each provided field.
  const patch: Record<string, unknown> = {};

  if (body.label !== undefined) {
    const labelRaw =
      typeof body.label === "string" ? body.label.trim() : "";
    if (!labelRaw || labelRaw.length > LABEL_MAX) {
      return fail(400, `label must be 1-${LABEL_MAX} characters.`, "label");
    }
    // Duplicate-label guard (ignore own row).
    if (labelRaw.toLowerCase() !== String(existing.label).toLowerCase()) {
      const { data: dupe } = await supabaseAdmin
        .from("addresses")
        .select("id")
        .eq("customer_id", customer.id)
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

  const makeDefault = body.make_default === true;

  if (Object.keys(patch).length === 0 && !makeDefault) {
    // Nothing to do — return the row as-is for caller idempotency.
    return NextResponse.json({ ok: true, address: existing });
  }

  // Promote-to-default: clear the existing default first to honour the
  // one-default-per-customer unique index, then flip this row.
  if (makeDefault && !existing.is_default) {
    const { error: clearErr } = await supabaseAdmin
      .from("addresses")
      .update({ is_default: false })
      .eq("customer_id", customer.id);
    if (clearErr) {
      console.error("[mobile/addresses PATCH] clear default failed:", clearErr);
      return fail(500, "Failed to update addresses");
    }
    patch.is_default = true;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, address: existing });
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
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
    console.error("[mobile/addresses PATCH] update failed:", updateErr);
    return fail(500, "Failed to update address");
  }

  return NextResponse.json({ ok: true, address: updated });
}

// ---------------------------------------------------------------------------
// DELETE /api/mobile/addresses/[id]
// ---------------------------------------------------------------------------
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = auth(req);
  if (!authResult.ok) return authResult.res;
  const { phoneLocal } = authResult;

  const { id } = await params;
  if (!id) return fail(400, "Missing address id");

  // Resolve customer.
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (!customer) return fail(404, "Address not found");

  // Fetch the address — verify ownership.
  const { data: address, error: fetchErr } = await supabaseAdmin
    .from("addresses")
    .select(ADDRESS_COLS)
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) {
    console.error("[mobile/addresses DELETE] fetch failed:", fetchErr);
    return fail(500, "Failed to fetch address");
  }
  if (!address || address.customer_id !== customer.id) {
    return fail(404, "Address not found");
  }

  const wasDefault = address.is_default as boolean;

  // Delete it.
  const { error: delErr } = await supabaseAdmin
    .from("addresses")
    .delete()
    .eq("id", id);
  if (delErr) {
    console.error("[mobile/addresses DELETE] delete failed:", delErr);
    return fail(500, "Failed to delete address");
  }

  // If it was the default, promote the most-recently created remaining address.
  if (wasDefault) {
    const { data: remaining } = await supabaseAdmin
      .from("addresses")
      .select("id")
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (remaining && remaining.length > 0) {
      await supabaseAdmin
        .from("addresses")
        .update({ is_default: true })
        .eq("id", remaining[0].id);
    }
  }

  return new NextResponse(null, { status: 204 });
}
