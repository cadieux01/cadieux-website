import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";

// GET — admin detail view. Returns the customer row + every order
// they've placed + every subscription they hold + push token presence.
// No pagination on orders/subs by design — at launch we don't expect a
// single customer to exceed a few hundred rows.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = params.id;

  const { data: customer, error: cErr } = await supabaseAdmin
    .from("customers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (cErr) {
    console.error("[admin/customers detail]", cErr.message);
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }
  if (!customer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ordersP = supabaseAdmin
    .from("orders")
    .select("id, total_amount, status, delivery_address, created_at, latitude, longitude")
    .eq("customer_id", id)
    .order("created_at", { ascending: false });
  const addressesP = supabaseAdmin
    .from("addresses")
    .select("id, label, full_name, line1, area, city, pincode, is_default, created_at, latitude, longitude")
    .eq("customer_id", id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  const subsP = supabaseAdmin
    .from("subscriptions")
    .select(
      "id, product_name, total_weeks, status, payment_status, total_amount, created_at, frequency",
    )
    .eq("customer_id", id)
    .order("created_at", { ascending: false });
  // push_tokens may not exist on every environment; on error we
  // degrade silently to an empty list rather than 500 the whole page.
  const tokensP = supabaseAdmin
    .from("push_tokens")
    .select("token, platform, updated_at")
    .eq("customer_id", id)
    .order("updated_at", { ascending: false });

  const [oRes, aRes, sRes, tRes] = await Promise.all([ordersP, addressesP, subsP, tokensP]);

  return NextResponse.json({
    customer,
    orders: oRes.data ?? [],
    addresses: aRes.data ?? [],
    subscriptions: sRes.data ?? [],
    push_tokens: tRes.error ? [] : tRes.data ?? [],
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};

  if (body.full_name !== undefined) {
    const v = String(body.full_name ?? "").trim();
    update.full_name = v || null;
  }
  if (body.phone !== undefined) {
    const v = String(body.phone ?? "").trim();
    update.phone = v || null;
  }
  if (body.city !== undefined) {
    const v = String(body.city ?? "").trim();
    update.city = v || null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data: updated, error } = await supabaseAdmin
    .from("customers")
    .update(update)
    .eq("id", params.id)
    .select("id, full_name, phone")
    .maybeSingle();

  if (error) {
    console.error("[admin/customers update]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  void recordAuditEvent({
    req,
    entity: "customer",
    action: "update",
    targetId: params.id,
    targetLabel: updated?.full_name || updated?.phone || params.id,
    context: `Updated customer ${updated?.full_name ?? params.id}`,
    meta: { fields: Object.keys(update) },
  });

  return NextResponse.json({ ok: true });
}
