import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import {
  buildDerivations,
  DeliveryLite,
  DerivedSub,
  SubLite,
} from "@/lib/admin-subscription-derive";
import {
  matchSubscriptionCoordinates,
  type AddressCoordRow,
} from "@/lib/subscription-coordinates";
import type { AdminSubscriptionItem } from "@/lib/admin-shared";

const ALLOWED_FILTERS = new Set([
  "all",
  "pending_confirmation",
  "active",
  "completed",
  "cancelled",
  "paused",
]);

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
  // subscription_id → per-variant lines. The board shows "Multigrain 1,
  // Plain 1", which the subscriptions row alone cannot express.
  const itemsBySub = new Map<string, AdminSubscriptionItem[]>();
  // customer_id → matched non-zero coords (subscriptions have no lat/lng
  // of their own; we pull them from public.addresses). Absent = no usable
  // saved coords → the UI falls back to an address-text Maps search.
  const coordsBySub = new Map<
    string,
    { latitude: number; longitude: number }
  >();
  if (enrich) {
    const subIds = subs.map((s) => s.id);
    const { data: deliveries } = await supabaseAdmin
      .from("subscription_deliveries")
      .select(
        "subscription_id, delivery_date, scheduled_date, scheduled_time_slot, slot, sequence, week_number, status",
      )
      .in("subscription_id", subIds);

    const { data: items } = await supabaseAdmin
      .from("subscription_items")
      .select("subscription_id, product_slug, product_name, quantity_per_delivery")
      .in("subscription_id", subIds)
      .order("created_at", { ascending: true });
    for (const it of items ?? []) {
      const list = itemsBySub.get(it.subscription_id) ?? [];
      list.push({
        product_slug: it.product_slug,
        product_name: it.product_name,
        quantity_per_delivery: it.quantity_per_delivery,
      });
      itemsBySub.set(it.subscription_id, list);
    }

    const subLites: SubLite[] = subs.map((s) => ({
      id: s.id,
      total_weeks: s.total_weeks,
      created_at: s.created_at,
    }));
    derivedById = buildDerivations(
      subLites,
      (deliveries as DeliveryLite[]) ?? [],
    );

    // Saved addresses for these customers, grouped for coordinate matching.
    const { data: addresses } = await supabaseAdmin
      .from("addresses")
      .select("customer_id, line1, pincode, is_default, latitude, longitude")
      .in("customer_id", customerIds);
    const addrByCustomer = new Map<string, AddressCoordRow[]>();
    for (const a of addresses ?? []) {
      const list = addrByCustomer.get(a.customer_id) ?? [];
      list.push(a);
      addrByCustomer.set(a.customer_id, list);
    }
    for (const s of subs) {
      const c = matchSubscriptionCoordinates(
        addrByCustomer.get(s.customer_id),
        {
          line1: s.delivery_address?.line1 ?? s.customer_address ?? null,
          pincode: s.delivery_address?.pincode ?? s.customer_pincode ?? null,
        },
      );
      if (c) coordsBySub.set(s.id, c);
    }
  }

  return NextResponse.json({
    subscriptions: subs.map((s) => ({
      ...s,
      customer: cmap.get(s.customer_id) ?? null,
      ...(derivedById?.get(s.id) ?? {}),
      ...(enrich ? { items: itemsBySub.get(s.id) ?? [] } : {}),
      ...(coordsBySub.get(s.id) ?? {}),
    })),
  });
}
