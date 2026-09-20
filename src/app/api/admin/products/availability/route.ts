// /api/admin/products/availability — read-only feed for admin date pickers.
//
// GET → { products: [{ id, name, available_from }, …] }
//
// Feeds the Multigrain-floor warning on the delivery-date pickers (orders +
// subscriptions). Live-read on purpose: `available_from` is cleared by a
// scheduled task at 06:00 IST on the availability date, and a hard-coded
// floor in the client would keep warning after clearance. Admin-gated.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await supabaseAdmin
    .from("products")
    .select("id, name, available_from")
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
