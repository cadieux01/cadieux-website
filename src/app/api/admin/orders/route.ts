import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, customer_id, total_amount, status, delivery_address, delivery_date, delivery_slot, items, created_at, latitude, longitude, customers(id, full_name, phone, city)"
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[admin/orders list]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ orders: data ?? [] });
}
