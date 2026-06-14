import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

// GET /api/admin/order-change-requests?status=pending|approved|rejected|cancelled|all
//
// Admin queue for customer-submitted COD delivery change-requests. Hydrates
// each request with the order's CURRENT delivery values (for the old→new
// diff) and the customer (name/phone). Mirrors /api/admin/change-requests.

const ALLOWED_FILTERS = new Set([
  "all",
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const filter = (req.nextUrl.searchParams.get("status") ?? "all").toLowerCase();
  if (!ALLOWED_FILTERS.has(filter)) {
    return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
  }

  let query = supabaseAdmin
    .from("order_change_requests")
    .select("*")
    .order("created_at", { ascending: false });
  if (filter !== "all") query = query.eq("status", filter);

  const { data: requests, error } = await query;
  if (error) {
    console.error("[admin/order-change-requests list]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!requests || requests.length === 0) {
    return NextResponse.json({ requests: [] });
  }

  // Hydrate order (current values + ownership) and customer for context.
  const orderIds = Array.from(new Set(requests.map((r) => r.order_id)));
  const { data: orders } = await supabaseAdmin
    .from("orders")
    .select(
      "id, customer_id, status, payment_method, payment_status, delivery_date, delivery_slot, delivery_address, items, total_amount",
    )
    .in("id", orderIds);

  const customerIds = Array.from(
    new Set((orders ?? []).map((o) => o.customer_id).filter(Boolean)),
  );
  const { data: customers } =
    customerIds.length > 0
      ? await supabaseAdmin
          .from("customers")
          .select("id, full_name, phone")
          .in("id", customerIds)
      : { data: [] };

  const omap = new Map((orders ?? []).map((o) => [o.id, o]));
  const cmap = new Map((customers ?? []).map((c) => [c.id, c]));

  return NextResponse.json({
    requests: requests.map((r) => {
      const order = omap.get(r.order_id) ?? null;
      return {
        ...r,
        order,
        customer: order?.customer_id ? cmap.get(order.customer_id) ?? null : null,
      };
    }),
  });
}
