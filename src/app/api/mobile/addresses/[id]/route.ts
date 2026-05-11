// /api/mobile/addresses/[id]
//
// DELETE — remove a saved address.
//
// Ownership check: address must belong to the verified phone's customer.
// If deleting the default and other addresses remain, the most-recently
// created non-deleted address is promoted to default.

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
