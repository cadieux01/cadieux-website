// /api/orders/[id]
// Returns a single order's full details for the verified-phone customer
// that owns it. Used by the web order detail page (/orders/[id]) and
// the post-checkout "View Order" link on /checkout/success.
//
// Auth: cookie-based via getVerifiedPhone(req). The order's customer must
// match the verified phone, otherwise we respond 404 (not 403 — don't leak
// the existence of unrelated orders).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone } from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = (params.id || "").trim();
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }

  const verified = getVerifiedPhone(req);
  if (!verified) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) {
    return NextResponse.json({ error: "Phone format" }, { status: 400 });
  }

  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (!customer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, total_amount, delivery_fee, status, status_updated_at, delivery_address, items, delivery_date, delivery_slot, created_at, cancelled_at, cancellation_reason, refund_status, payment_method, payment_status, customer_id",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[orders/[id]] fetch failed:", error.message);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
  if (!order || order.customer_id !== customer.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Strip customer_id from the response — the client doesn't need it.
  const { customer_id: _omit, ...rest } = order;
  void _omit;
  return NextResponse.json({ order: rest });
}
