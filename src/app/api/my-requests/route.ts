// GET /api/my-requests
//
// Read-only aggregator for the customer "Your Requests" page on the website.
// Returns the verified customer's:
//   - order change requests (type IN ('delivery','items'))
//   - subscription change requests
//   - payment history (derived from their orders)
//
// Auth: cookie-based (cdx_phone_verified) via getVerifiedPhone(). Same model
// as every other customer endpoint on the site. Owner-scoped by customer_id
// — never reads or returns another customer's rows.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone } from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";
import { loadMyRequests, stripInternalOrderNumbers } from "@/lib/my-requests";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export async function GET(req: NextRequest) {
  const verified = getVerifiedPhone(req);
  if (!verified) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) {
    return NextResponse.json(
      { ok: false, error: "Phone format" },
      { status: 400 },
    );
  }

  const { data: customer, error: custErr } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (custErr) {
    console.error("[my-requests] customer lookup failed:", custErr.message);
    return NextResponse.json(
      { ok: false, error: "Lookup failed" },
      { status: 500 },
    );
  }
  if (!customer) {
    // No customer record yet — but the verified phone may already have
    // filed an unserviceable-pincode request from the checkout CTA. Try
    // by phone before returning an empty payload.
    try {
      const payload = await loadMyRequests(supabaseAdmin, "", phoneLocal);
      return NextResponse.json({ ok: true, ...stripInternalOrderNumbers(payload) });
    } catch {
      return NextResponse.json({
        ok: true,
        order_change_requests: [],
        subscription_change_requests: [],
        payments: [],
        delivery_requests: [],
      });
    }
  }

  try {
    const payload = await loadMyRequests(supabaseAdmin, customer.id, phoneLocal);
    return NextResponse.json({ ok: true, ...stripInternalOrderNumbers(payload) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[my-requests] load failed:", message);
    return NextResponse.json(
      { ok: false, error: "Failed to load requests" },
      { status: 500 },
    );
  }
}
