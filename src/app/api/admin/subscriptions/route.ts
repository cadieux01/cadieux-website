import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import {
  buildDerivations,
  DeliveryLite,
  DerivedSub,
  SubLite,
} from "@/lib/admin-subscription-derive";

const ALLOWED_FILTERS = new Set(["all", "active", "completed", "cancelled", "paused"]);

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const filter = (req.nextUrl.searchParams.get("status") ?? "all").toLowerCase();
  if (!ALLOWED_FILTERS.has(filter)) {
    return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
  }
  // `?enrich=1` opts new admin pages into derived_end_date +
  // remaining_deliveries hydration. Legacy /admin page omits this
  // and gets the original payload shape unchanged.
  const enrich = req.nextUrl.searchParams.get("enrich") === "1";

  let query = supabaseAdmin
    .from("subscriptions")
    .select("*")
    .order("created_at", { ascending: false });

  if (filter !== "all") {
    query = query.eq("status", filter);
  }

  const { data: subs, error } = await query;
  if (error) {
    console.error("[admin/subscriptions list]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!subs || subs.length === 0) {
    return NextResponse.json({ subscriptions: [] });
  }

  // Resolve customer phone/name for display
  const customerIds = Array.from(new Set(subs.map((s) => s.customer_id)));
  const { data: customers } = await supabaseAdmin
    .from("customers")
    .select("id, full_name, phone, city")
    .in("id", customerIds);
  const cmap = new Map((customers ?? []).map((c) => [c.id, c]));

  let derivedById: Map<string, DerivedSub> | null = null;
  if (enrich) {
    const subIds = subs.map((s) => s.id);
    const { data: deliveries } = await supabaseAdmin
      .from("subscription_deliveries")
      .select("subscription_id, delivery_date, status")
      .in("subscription_id", subIds);
    const subLites: SubLite[] = subs.map((s) => ({
      id: s.id,
      total_weeks: s.total_weeks,
      created_at: s.created_at,
    }));
    derivedById = buildDerivations(
      subLites,
      (deliveries as DeliveryLite[]) ?? [],
    );
  }

  return NextResponse.json({
    subscriptions: subs.map((s) => ({
      ...s,
      customer: cmap.get(s.customer_id) ?? null,
      ...(derivedById?.get(s.id) ?? {}),
    })),
  });
}
