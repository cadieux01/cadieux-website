// /api/mobile/orders
// Returns the verified phone's order history, newest first.
// Same auth model as Phase 3b/3c: X-App-Key + Authorization: Bearer <token>.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone, isValidMobileAppKey } from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export async function GET(req: NextRequest) {
  if (!process.env.MOBILE_APP_KEY) {
    return NextResponse.json(
      { ok: false, error: "Server misconfigured" },
      { status: 500 },
    );
  }
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }
  const verified = getVerifiedPhone(req);
  if (!verified) {
    return NextResponse.json(
      { ok: false, error: "Phone not verified" },
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

  // Lookup customer_id by phone.
  const { data: customer, error: custErr } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (custErr) {
    console.error("[mobile/orders] customer lookup failed:", custErr);
    return NextResponse.json(
      { ok: false, error: "Lookup failed" },
      { status: 500 },
    );
  }
  if (!customer) {
    return NextResponse.json({ ok: true, orders: [] });
  }

  // Fetch orders.
  const { data: orders, error: ordersErr } = await supabaseAdmin
    .from("orders")
    .select(
      "id, total_amount, status, status_updated_at, delivery_address, items, delivery_date, delivery_slot, created_at, cancelled_at, cancellation_reason, refund_status, fulfillment_type, pickup_location_id, pickup_ready_at, picked_up_at",
    )
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (ordersErr) {
    console.error("[mobile/orders] orders fetch failed:", ordersErr);
    return NextResponse.json(
      { ok: false, error: "Fetch failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, orders: orders ?? [] });
}
