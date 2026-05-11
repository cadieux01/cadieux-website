// /api/mobile/addresses/[id]/default
//
// POST — make [id] the default address for the verified customer.
//
// Sequence (safe against the unique partial index):
//   1. Clear is_default on all addresses for this customer.
//   2. Set is_default=true on the target address.
// Ownership check: address must belong to the caller's customer.

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

const ADDRESS_COLS = "id, customer_id, label, full_name, line1, area, city, pincode, is_default, created_at";

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
// POST /api/mobile/addresses/[id]/default
// ---------------------------------------------------------------------------
export async function POST(
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

  // Verify ownership.
  const { data: address, error: fetchErr } = await supabaseAdmin
    .from("addresses")
    .select("id, customer_id")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) {
    console.error("[mobile/addresses default] fetch failed:", fetchErr);
    return fail(500, "Failed to fetch address");
  }
  if (!address || address.customer_id !== customer.id) {
    return fail(404, "Address not found");
  }

  // Step 1: clear all defaults for this customer.
  const { error: clearErr } = await supabaseAdmin
    .from("addresses")
    .update({ is_default: false })
    .eq("customer_id", customer.id);
  if (clearErr) {
    console.error("[mobile/addresses default] clear failed:", clearErr);
    return fail(500, "Failed to update addresses");
  }

  // Step 2: set this one as default.
  const { data: updated, error: setErr } = await supabaseAdmin
    .from("addresses")
    .update({ is_default: true })
    .eq("id", id)
    .select(ADDRESS_COLS)
    .single();
  if (setErr || !updated) {
    console.error("[mobile/addresses default] set failed:", setErr);
    return fail(500, "Failed to set default");
  }

  return NextResponse.json({ ok: true, address: updated });
}
