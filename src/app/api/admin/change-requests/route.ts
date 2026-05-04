import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

const ALLOWED_FILTERS = new Set(["all", "pending", "approved", "rejected"]);

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const filter = (req.nextUrl.searchParams.get("status") ?? "all").toLowerCase();
  if (!ALLOWED_FILTERS.has(filter)) {
    return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
  }

  let query = supabaseAdmin
    .from("subscription_change_requests")
    .select("*")
    .order("created_at", { ascending: false });
  if (filter !== "all") query = query.eq("status", filter);

  const { data: requests, error } = await query;
  if (error) {
    console.error("[admin/change-requests list]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!requests || requests.length === 0) {
    return NextResponse.json({ requests: [] });
  }

  // Hydrate delivery + subscription + customer for context.
  const deliveryIds = requests.map((r) => r.delivery_id);
  const subIds = Array.from(new Set(requests.map((r) => r.subscription_id)));

  const [{ data: deliveries }, { data: subs }] = await Promise.all([
    supabaseAdmin
      .from("subscription_deliveries")
      .select("id, week_number, scheduled_date, scheduled_time_slot, status")
      .in("id", deliveryIds),
    supabaseAdmin
      .from("subscriptions")
      .select("id, customer_id, product_name, total_weeks")
      .in("id", subIds),
  ]);

  const customerIds = Array.from(
    new Set((subs ?? []).map((s) => s.customer_id))
  );
  const { data: customers } = await supabaseAdmin
    .from("customers")
    .select("id, full_name, phone")
    .in("id", customerIds);

  const dmap = new Map((deliveries ?? []).map((d) => [d.id, d]));
  const smap = new Map((subs ?? []).map((s) => [s.id, s]));
  const cmap = new Map((customers ?? []).map((c) => [c.id, c]));

  return NextResponse.json({
    requests: requests.map((r) => {
      const sub = smap.get(r.subscription_id) ?? null;
      return {
        ...r,
        delivery: dmap.get(r.delivery_id) ?? null,
        subscription: sub,
        customer: sub ? cmap.get(sub.customer_id) ?? null : null,
      };
    }),
  });
}
