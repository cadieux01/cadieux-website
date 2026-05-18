// Admin list of customer-submitted "deliver here please" requests.
// Filterable by status; results are hydrated with the matching customer
// (by phone) when possible so the admin UI can show a name + click-to-
// contact widget.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

const ALLOWED_FILTERS = new Set(["all", "pending", "serviceable", "rejected"]);

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const filter = (req.nextUrl.searchParams.get("status") ?? "pending").toLowerCase();
  if (!ALLOWED_FILTERS.has(filter)) {
    return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
  }

  let query = supabaseAdmin
    .from("delivery_requests")
    .select(
      "id, customer_id, phone, pincode, area_name, address, status, resolved_at, resolved_by, resolution_note, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (filter !== "all") query = query.eq("status", filter);

  const { data, error } = await query;
  if (error) {
    console.error("[admin/delivery-requests] list failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  // Hydrate customers by phone (digits-only, 10-digit normalised form).
  const phones = Array.from(new Set(rows.map((r) => r.phone))).filter(Boolean);
  let customerMap = new Map<string, { id: string; full_name: string | null }>();
  if (phones.length > 0) {
    const { data: customers } = await supabaseAdmin
      .from("customers")
      .select("id, full_name, phone")
      .in("phone", phones);
    customerMap = new Map(
      (customers ?? []).map((c) => [c.phone as string, { id: c.id, full_name: c.full_name }]),
    );
  }

  return NextResponse.json({
    requests: rows.map((r) => ({
      ...r,
      customer: customerMap.get(r.phone) ?? null,
    })),
  });
}
