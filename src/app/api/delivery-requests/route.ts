// Public endpoint for customers whose pincode is not currently
// serviceable. Called from the web checkout (and later the mobile app)
// when the user clicks "Send Request to Deliver at Your Location".
//
// Cart contents are NOT submitted — we only need to know where the
// customer is so admin can either activate the pincode or follow up
// directly. The user's cart is preserved client-side.

import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/admin-auth";
import { apiRateLimit, getClientIP } from "@/lib/ratelimit";
import { normalizePincode } from "@/lib/service-areas";

function normalizePhoneDigits(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  // Accept 10-digit (assume IN) or 12-digit (with country code) inputs.
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return null;
}

export async function POST(req: NextRequest) {
  const { success: ok } = await apiRateLimit.limit(getClientIP(req));
  if (!ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429 },
    );
  }

  const body = (await req.json().catch(() => null)) as
    | {
        phone?: unknown;
        pincode?: unknown;
        area_name?: unknown;
        address?: unknown;
        customer_id?: unknown;
      }
    | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const phone = normalizePhoneDigits(body.phone);
  const pincode = normalizePincode(body.pincode);
  const address =
    typeof body.address === "string" ? body.address.trim() : "";
  const areaName =
    typeof body.area_name === "string" && body.area_name.trim()
      ? body.area_name.trim().slice(0, 120)
      : null;
  const customerId =
    typeof body.customer_id === "string" && body.customer_id.trim()
      ? body.customer_id.trim()
      : null;

  if (!phone) {
    return NextResponse.json(
      { error: "A 10-digit phone number is required" },
      { status: 400 },
    );
  }
  if (!pincode) {
    return NextResponse.json(
      { error: "Pincode must be 6 digits" },
      { status: 400 },
    );
  }
  if (!address || address.length > 500) {
    return NextResponse.json(
      { error: "Address is required (max 500 chars)" },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("delivery_requests")
    .insert({
      customer_id: customerId,
      phone,
      pincode,
      area_name: areaName,
      address,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) {
    console.error("[delivery-requests] insert failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data?.id ?? null });
}
