import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select(
      "id, bread_slug, bread_name, bread_price, weeks, days, slot_mode, slot, slots_by_day, total, customer_name, customer_phone, customer_address, customer_city, customer_pincode, status, created_at"
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[admin/subscriptions list]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ subscriptions: data ?? [] });
}
