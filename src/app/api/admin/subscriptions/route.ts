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
import { ADMIN_HIDDEN_SUBSCRIPTION_FILTER } from "@/lib/subscription-visibility";

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
    // Unpaid shells (row written, Razorpay sheet never completed) must not
    // reach the fulfilment floor — bread gets set aside for them otherwise.
    //
    // The ADMIN_ set deliberately does NOT hide 'paid_orphaned'. This board is
    // the durable surface for a payment that landed after the sweep: the alert
    // email is only a doorbell and can be eaten by a bad Resend day. An orphan
    // must be sitting here waiting whether or not that email ever arrived.
    .not("payment_status", "in", ADMIN_HIDDEN_SUBSCRIPTION_FILTER)
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

  // Resolve customer phone/name for display.
  //
  // NOTE: this is the CURRENT customers row, not the subscription's own
  // signup snapshot (subscriptions.customer_name / customer_phone). One
  // phone can accumulate several names over time — a later order placed
  // for a family member rewrites customers.full_name, and every past
  // subscription on that customer_id then displays the new name. So the
  // admin list can legitimately show a name the plan was never booked
  // under. That is a stale join, NOT data corruption: the name the
  // customer actually signed up with is still on the subscriptions row.
  // Read the snapshot instead if you need booking-time truth.
  const customerIds = Array.from(new Set(subs.map((s) => s.customer_id)));
  const subIds = subs.map((s) => s.id);

  // These four depend only on the subscription list, never on each other, so
  // they go out together. Awaiting them one at a time cost four sequential
  // round trips to Supabase (ap-northeast-1) from the function region — about
  // 0.2s each, repeated by the board's 10-second poll. The queries themselves
  // execute in well under a millisecond; the wire was the whole cost.
  //
  // `null` for the enrich-only queries keeps the tuple shape fixed so the
  // destructure below stays type-safe.
  const [customersRes, deliveriesRes, itemsRes, addressesRes] =
    await Promise.all([
      supabaseAdmin
        .from("customers")
        .select("id, full_name, phone, city")
        .in("id", customerIds),
      enrich
        ? supabaseAdmin
            .from("subscription_deliveries")
            .select(
              "subscription_id, delivery_date, scheduled_date, scheduled_time_slot, slot, sequence, week_number, status",
            )
            .in("subscription_id", subIds)
        : null,
      enrich
        ? supabaseAdmin
            .from("subscription_items")
            .select(
              "subscription_id, product_slug, product_name, quantity_per_delivery",
            )
            .in("subscription_id", subIds)
            .order("created_at", { ascending: true })
        : null,
      enrich
        ? supabaseAdmin
            .from("addresses")
            .select(
              "customer_id, line1, pincode, is_default, latitude, longitude",
            )
            .in("customer_id", customerIds)
        : null,
    ]);

  const cmap = new Map((customersRes.data ?? []).map((c) => [c.id, c]));

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
    const deliveries = deliveriesRes?.data;
    const items = itemsRes?.data;
    const addresses = addressesRes?.data;

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
