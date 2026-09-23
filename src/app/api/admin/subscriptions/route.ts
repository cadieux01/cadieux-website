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
import {
  countDeliveries,
  countDeliveriesByDate,
  countsByDateToRecord,
  type CountableDelivery,
} from "@/lib/subscription-counts";
import { aggregateNotesFor } from "@/lib/order-notes";

// Server-side allowlist for the optional `?status=` param. This is INPUT
// VALIDATION, not a menu — the board itself fetches everything and filters
// client-side so the dropdown can show live per-status counts.
//
// 'paused' was removed: there is no such value in public.subscriptions and
// there never has been. It was also hardcoded into the old chip row, where it
// rendered a permanent "PAUSED · 0". Nothing can have bookmarked it, because
// it could never have matched a row.
const ALLOWED_FILTERS = new Set([
  "all",
  "pending_confirmation",
  "active",
  "completed",
  "cancelled",
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

  // NO payment_status FILTER. This board returns every subscription row.
  //
  // It used to carry `.not("payment_status","in",("created","abandoned"))`.
  // The stated reason was that unpaid shells must not reach the fulfilment
  // floor, or bread gets set aside for a plan nobody paid for. That reason
  // does not survive contact with the data: every hidden row already had its
  // subscription_deliveries written at checkout (OLS39 had 2, OLS18 had 9).
  // Hiding them here never kept one loaf off the bake — it only removed the
  // one surface on which a human could have noticed and rung the customer.
  //
  // It cost us OLS39: a completed checkout, due to start the next day, that
  // nobody called because the only board that could have shown her refused
  // to. OLS34 was the same shape the day before.
  //
  // ADMIN_HIDDEN_SUBSCRIPTION_FILTER still exists and is still correct for
  // the customer-facing surfaces; it is simply not this board's business.
  // Note it deliberately never hid 'paid_orphaned' — this board is the
  // durable surface for a payment that landed after the sweep, because the
  // alert email is only a doorbell and can be eaten by a bad Resend day.
  //
  // "Must not be baked" and "must not be seen" are different requirements.
  // The bake question is answered where it belongs — the production strip
  // counts unpaid rows on their OWN line rather than silently including or
  // excluding them (see ProductionCountStrip) — and the board offers
  // "Payment not completed" / "Checkout in progress" as explicit, countable
  // filter groups instead of a filter nobody could see.
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
              "subscription_id, delivery_date, scheduled_date, scheduled_time_slot, slot, sequence, week_number, status, items_override",
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
  // subscription_id → slug → loaves across every non-cancelled delivery.
  //
  // Summed HERE rather than shipped as delivery rows for the client to
  // add up. The board polls every 10 seconds; 113 delivery rows carrying
  // an items_override jsonb each is a lot of wire to re-send for two
  // numbers per subscription. The per-DELIVERY figure the row's tooltip
  // shows is derived client-side from `items`, which is already sent.
  const countsBySub = new Map<string, Record<string, number>>();
  // subscription_id → date → slug → loaves, over the same deliveries and the
  // same items_override precedence, bucketed by the day each stop lands on.
  // Feeds the summary bar when the board has a date filter active — without
  // it the bar can only report the whole plan, which on a date-filtered
  // board is an answer to a question nobody asked.
  const countsByDateBySub = new Map<
    string,
    Record<string, Record<string, number>>
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

    const deliveriesBySub = new Map<string, CountableDelivery[]>();
    for (const d of (deliveries ?? []) as (CountableDelivery & {
      subscription_id: string;
    })[]) {
      const list = deliveriesBySub.get(d.subscription_id) ?? [];
      list.push(d);
      deliveriesBySub.set(d.subscription_id, list);
    }
    for (const s of subs) {
      const plan = {
        product_name: s.product_name,
        quantity_per_delivery: s.quantity_per_delivery,
        items: itemsBySub.get(s.id) ?? [],
      };
      const rows = deliveriesBySub.get(s.id) ?? [];
      countsBySub.set(s.id, Object.fromEntries(countDeliveries(rows, plan)));
      countsByDateBySub.set(
        s.id,
        countsByDateToRecord(countDeliveriesByDate(rows, plan)),
      );
    }

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

  // Batch-fetch note aggregates for every subscription in the list. Same
  // shape the orders route attaches, so the shared NotePanel + inline
  // chip work off identical fields on both boards.
  const noteAgg = await aggregateNotesFor(supabaseAdmin, "subscription", subIds);

  return NextResponse.json({
    subscriptions: subs.map((s) => {
      const agg = noteAgg.get(s.id);
      return {
        ...s,
        customer: cmap.get(s.customer_id) ?? null,
        ...(derivedById?.get(s.id) ?? {}),
        ...(enrich
          ? {
              items: itemsBySub.get(s.id) ?? [],
              loaf_counts: countsBySub.get(s.id) ?? {},
              loaf_counts_by_date: countsByDateBySub.get(s.id) ?? {},
            }
          : {}),
        ...(coordsBySub.get(s.id) ?? {}),
        note_count: agg?.note_count ?? 0,
        last_call_note: agg?.last_call_note ?? null,
        // The orders board shows the latest note's text under the status.
        // `aggregateNotesFor` already computes it; the route simply was not
        // forwarding it, so the subscriptions board could not show the same.
        last_note: agg?.last_note ?? null,
      };
    }),
  });
}
