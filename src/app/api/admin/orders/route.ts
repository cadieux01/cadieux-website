import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, customer_id, total_amount, status, payment_method, payment_status, delivery_address, delivery_date, delivery_slot, items, created_at, latitude, longitude, fulfillment_type, pickup_location_id, pickup_ready_at, picked_up_at, customers(id, full_name, phone, city)"
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[admin/orders list]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Side-fetch pickup_locations for any order that references one. Done as a
  // manual join (rather than a PostgREST embed) because there's no FK between
  // orders.pickup_location_id and pickup_locations.id yet.
  const rows = data ?? [];
  const pickupIds = Array.from(
    new Set(
      rows
        .map((r: { pickup_location_id?: string | null }) => r.pickup_location_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );
  let pickupById: Record<string, { id: string; name: string; area: string; address: string }> = {};
  if (pickupIds.length > 0) {
    const { data: locs } = await supabaseAdmin
      .from("pickup_locations")
      .select("id, name, area, address")
      .in("id", pickupIds);
    for (const l of locs ?? []) {
      pickupById[l.id] = l;
    }
  }
  const enriched = rows.map((r: { pickup_location_id?: string | null }) => ({
    ...r,
    pickup_location: r.pickup_location_id ? pickupById[r.pickup_location_id] ?? null : null,
  }));

  return NextResponse.json({ orders: enriched });
}
