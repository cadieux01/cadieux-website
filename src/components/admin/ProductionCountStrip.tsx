"use client";

// Production-count summary strip shown above the /admin/orders table.
//
// It answers the one question Sunny asks at 5am: how many loaves of each
// kind do I have to bake, and across how many orders? The strip
// recomputes from the SAME filtered array the table renders — so the
// numbers cannot disagree with what the operator is scrolling.
//
// TWO SOURCES, ONE OVEN. A day's bread is one-time orders PLUS the
// subscription stops due that day. The strip counted only the first, so the
// number on screen at 5am was an UNDER-count of the number in the 18:00
// bake-plan email — and under-baking is the expensive direction: the loaf
// that was never made cannot be handed over at the door. Subscription stops
// arrive via `subscriptions`, loaded by the same query the email uses
// (see @/lib/bake-plan-lines) and split out in the label rather than fused
// into one unattributable total.
//
// Rules:
//   - "loaves" = sum of each line's quantity grouped by PRODUCT IDENTITY
//     (`slug ?? product_id`, see lib/order-items.ts), not by display
//     name. An order for 2 loaves counts 2 loaves.
//   - "stops" = distinct orders + distinct subscription deliveries that
//     contained at least one line of that product. Two lines of the same
//     product on one order count 1 stop.
//   - Cancelled orders are excluded entirely (they will not be baked).
//     Cancelled and delivered subscription stops never arrive — the loader
//     excludes them server-side.
//   - UNPAID IS COUNTED, NEVER DROPPED, and gets its own line. An unpaid
//     plan's deliveries are written at checkout and the bread still has to
//     be decided about; silently excluding them hides a decision, and
//     silently including them hides a risk. Paid is read from STATUS only,
//     never method — see payment-label.ts.
//   - No hardcoded product list — groups are whatever identities appear
//     in the filtered items, sorted by display name so the row order is
//     stable frame-to-frame.
//   - Empty filtered set → render nothing (no zero-noise strip).
//
// The type accepted is intentionally the narrow projection this strip
// needs, not `AdminOrderRow`, so if the row shape ever grows the strip
// stays a leaf.

import type { AdminOrderRow } from "@/lib/admin-shared";
import type { BakeItem } from "@/lib/bake-plan-lines";
import {
  productDisplayName,
  type ProductNameMap,
} from "@/lib/product-names";
import { isOrderFulfilled } from "@/lib/order-fulfillment";
import { isPaidStatus } from "@/lib/payment-label";
import { ZONE_LABELS, type ZoneKey } from "@/lib/delivery-zones";
import { itemQty, itemSlug, type OrderItemLike } from "@/lib/order-items";

/** One subscription stop due on the day the strip is showing. Shaped by
 *  GET /api/admin/bake-plan, which is a thin wrapper over the cron's
 *  loader — `ref` is the identity used to count distinct stops. */
export type BakeSubscriptionStop = {
  ref: string;
  items: BakeItem[];
  paid: boolean;
};

type ProductAgg = {
  /** Display name, resolved slug → catalogue (see lib/product-names.ts).
   *  Humans read this; nothing is bucketed by it. NOT the line's stored
   *  name: a snapshot says what was sold, and the strip is a bake list for
   *  tomorrow, so it must name the product as the catalogue does today. */
  name: string;
  /** Bucket identity. The product slug where the line carried one, else
   *  `name:<name>` for a line with no identity at all. */
  key: string;
  loaves: number;
  /** Distinct orders carrying this product. */
  orders: number;
  /** Distinct subscription stops carrying this product. */
  subStops: number;
};

export function aggregateProduction(
  orders: AdminOrderRow[],
  subscriptions: BakeSubscriptionStop[] = [],
  /** Live slug → catalogue name. Omitted, the bundled catalogue is used.
   *  Affects labels and therefore row ORDER (rows sort by display name);
   *  it can never affect a count, because counts key on the slug. */
  names?: ProductNameMap,
): {
  rows: ProductAgg[];
  totalLoaves: number;
  /** The split, kept separate so the total is never unattributable. */
  orderLoaves: number;
  subLoaves: number;
  /** Loaves nobody has paid for yet, and how many stops they sit on.
   *  Counted across BOTH sources. */
  unpaidLoaves: number;
  unpaidStops: number;
} {
  const byKey = new Map<
    string,
    {
      slug: string | null;
      /** First stored name seen. Used ONLY to label a line whose product is
       *  not in the catalogue — see productDisplayName. */
      snapshot: string;
      loaves: number;
      orderIds: Set<string>;
      subRefs: Set<string>;
    }
  >();

  // One line in. Bucketed on identity (`slug ?? product_id`, see
  // lib/order-items.ts) and never on the display string, so two lines
  // spelling the same product differently — the app's wording against the
  // web's, or an order placed either side of a rename — still land in the
  // same bucket.
  //
  // A line with NO identity keeps its own name-derived bucket rather than
  // being merged into a single "unknown" pile: two different unidentified
  // products must not silently add up together. There are no such lines on
  // prod today; this is the shape of the fallback, not a live path.
  //
  // Returns null for a line worth nothing — no quantity, or nothing at all
  // to identify it by. A line WITH a slug and no name is kept: the bread is
  // still going to be baked.
  const entryFor = (it: OrderItemLike) => {
    const slug = itemSlug(it);
    const snapshot = String(it?.name ?? "").trim();
    if (!slug && !snapshot) return null;
    const key = slug ?? `name:${snapshot.toLowerCase()}`;
    const e = byKey.get(key) ?? {
      slug,
      snapshot,
      loaves: 0,
      orderIds: new Set<string>(),
      subRefs: new Set<string>(),
    };
    byKey.set(key, e);
    return e;
  };

  let orderLoaves = 0;
  let subLoaves = 0;
  let unpaidLoaves = 0;
  const unpaidStopKeys = new Set<string>();

  for (const o of orders) {
    if ((o.status ?? "").toLowerCase() === "cancelled") continue;
    const paid = isPaidStatus(o.payment_status);
    for (const it of o.items ?? []) {
      const q = itemQty(it);
      if (q === 0) continue;
      const entry = entryFor(it);
      if (!entry) continue;
      entry.loaves += q;
      entry.orderIds.add(o.id);
      orderLoaves += q;
      if (!paid) {
        unpaidLoaves += q;
        unpaidStopKeys.add(`o:${o.id}`);
      }
    }
  }

  for (const s of subscriptions) {
    for (const it of s.items) {
      const q = itemQty(it);
      if (q === 0) continue;
      const entry = entryFor(it);
      if (!entry) continue;
      entry.loaves += q;
      entry.subRefs.add(s.ref);
      subLoaves += q;
      if (!s.paid) {
        unpaidLoaves += q;
        unpaidStopKeys.add(`s:${s.ref}`);
      }
    }
  }

  const rows = Array.from(byKey.entries())
    .map(([key, v]) => ({
      key,
      name: productDisplayName(v.slug, names, v.snapshot),
      loaves: v.loaves,
      orders: v.orderIds.size,
      subStops: v.subRefs.size,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    rows,
    totalLoaves: orderLoaves + subLoaves,
    orderLoaves,
    subLoaves,
    unpaidLoaves,
    unpaidStops: unpaidStopKeys.size,
  };
}

export function ProductionCountStrip({
  orders,
  subscriptions = [],
  zone,
  names,
}: {
  orders: AdminOrderRow[];
  /** Live slug → catalogue name, from the board. Omitted, the bundled
   *  catalogue is used. */
  names?: ProductNameMap;
  /** Subscription stops due on the SAME day, from /api/admin/bake-plan.
   *  Empty when the board is not on a single day — a bake is a day's
   *  question and there is no honest subscription number for "all dates".
   *  See the caller in /admin/orders. */
  subscriptions?: BakeSubscriptionStop[];
  /** When provided, the strip prefixes itself with the zone label. Used
   *  when the caller is rendering one strip per zone under an active zone
   *  filter — each strip aggregates only the rows for that zone, so a
   *  zoned bake plan cannot silently combine two zones' loaves. */
  zone?: ZoneKey;
}) {
  const { rows, totalLoaves, orderLoaves, subLoaves, unpaidLoaves, unpaidStops } =
    aggregateProduction(orders, subscriptions, names);

  // Fulfilment ratio for the current filter. Counted over the full
  // filtered set (cancelled and all), NOT over the bake set — the two
  // answer different questions. "N of M fulfilled" is about the slice
  // the operator is looking at, so filtering to "cancelled" honestly
  // shows "0 of N fulfilled", which is the right number.
  const totalOrders = orders.length;
  const fulfilledOrders = orders.reduce(
    (n, o) => (isOrderFulfilled(o) ? n + 1 : n),
    0,
  );

  // Nothing to bake AND no rows to summarise → no strip. When there IS
  // a filtered slice but nothing bakes (e.g. filter = 'cancelled'), the
  // strip still renders so the ratio is visible.
  if (rows.length === 0 && totalOrders === 0) return null;

  // Rows are labelled with the CATALOGUE name, resolved from the slug.
  // This used to render variantLabel(storedName) — the text after the em
  // dash — which was a compaction rule built for one naming scheme
  // ("Protein Bread — Multigrain" → "Multigrain") and silently returns the
  // whole string for any name without an em dash. The catalogue no longer
  // uses em dashes, so the rule now does nothing except disagree with the
  // shop. The order count sits in a title tooltip so it's one hover away
  // but stops competing with the loaf number that drives baking.
  return (
    <section
      aria-label="Production count for current filter"
      style={{
        margin: "0 0 12px",
        padding: "10px 14px",
        border: "1px solid rgba(251,243,212,0.18)",
        borderRadius: 6,
        background: "rgba(251,243,212,0.04)",
        color: "#FBF3D4",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "8px 20px",
        }}
      >
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.35em",
          textTransform: "uppercase",
          color: "rgba(251,243,212,0.6)",
        }}
      >
        Bake{zone ? ` · ${ZONE_LABELS[zone]}` : ""}
      </span>
      {rows.map((r, i) => {
        const label = r.name;
        return (
          <span
            key={r.key}
            title={
              r.subStops > 0
                ? `${r.orders} order${r.orders === 1 ? "" : "s"} · ${r.subStops} subscription stop${r.subStops === 1 ? "" : "s"}`
                : `${r.orders} order${r.orders === 1 ? "" : "s"}`
            }
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 14,
              fontWeight: 300,
              display: "inline-flex",
              alignItems: "baseline",
              gap: 6,
            }}
          >
            {i > 0 ? (
              <span
                aria-hidden="true"
                style={{ color: "rgba(251,243,212,0.35)", marginRight: 6 }}
              >
                ·
              </span>
            ) : null}
            <strong style={{ fontWeight: 500 }}>{label}</strong>
            <span style={{ color: "rgba(251,243,212,0.75)" }}>{r.loaves}</span>
          </span>
        );
      })}
      <span
        style={{
          marginLeft: "auto",
          fontFamily: "var(--font-body)",
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: "0.05em",
          display: "inline-flex",
          alignItems: "baseline",
          gap: 14,
        }}
      >
        {rows.length > 0 ? <span>{totalLoaves} loaves total</span> : null}
        <span style={{ color: "rgba(251,243,212,0.85)" }}>
          {fulfilledOrders} of {totalOrders} fulfilled
        </span>
      </span>
      </div>

      {/* SECOND LINE. The split and the unpaid count do not belong beside
          the per-product numbers: one is what to bake, the other is where
          it came from and what is at risk. Rendered only when there is
          something to say, so a plain paid orders-only day keeps the
          one-line strip it has always had. */}
      {subLoaves > 0 || unpaidLoaves > 0 ? (
        <div
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: "1px solid rgba(251,243,212,0.12)",
            display: "flex",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: "4px 18px",
            fontFamily: "var(--font-body)",
            fontSize: 13,
            fontWeight: 300,
          }}
        >
          {subLoaves > 0 ? (
            <span
              style={{ color: "rgba(251,243,212,0.75)" }}
              title="Subscription stops are scoped to the delivery day only — the status filter and the search box above narrow orders, not plans."
            >
              {orderLoaves} from orders · {subLoaves} from subscriptions
            </span>
          ) : null}
          {unpaidLoaves > 0 ? (
            // Amber, not red: this is not an error. It is bread nobody has
            // paid for yet, on a day it is due, and the decision to bake it
            // anyway is Sunny's to make with the number in front of him.
            <span style={{ color: "#E5B85C", fontWeight: 500 }}>
              {unpaidLoaves} unpaid, across {unpaidStops} stop
              {unpaidStops === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
