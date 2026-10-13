// /api/admin/products/availability — read-only feed for admin date pickers.
//
// GET → { products: [{ id, name, available_from, product_open_dates }, …] }
//
// Feeds the baking-days warning on the delivery-date pickers (orders +
// subscriptions). Live-read on purpose: a product's schedule is edited in the
// database with no deploy, and both halves of it decay with the calendar — a
// past `available_from` stops restricting anything, and an open date expires
// at IST midnight — so anything hard-coded in the client would keep warning
// about a day that is now fine. Admin-gated.
//
// There is NO scheduled task that clears `available_from`. An earlier version
// of this comment claimed one ran at 06:00 IST; it does not exist (vercel.json
// has four crons and none of them touch products), and the row is simply left
// in place to expire on its own. Nothing depends on it being cleared.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { OPEN_DATES_SELECT } from "@/lib/product-availability";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await supabaseAdmin
    .from("products")
    .select(`id, name, available_from, ${OPEN_DATES_SELECT}`)
    .order("id", { ascending: true });
  if (error) {
    console.error("[admin/products/availability GET]", error.message);
    return NextResponse.json(
      { error: "Failed to load product availability." },
      { status: 500 },
    );
  }
  return NextResponse.json({ products: data ?? [] });
}
