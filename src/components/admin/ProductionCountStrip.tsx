"use client";

// Production-count summary strips shown above the /admin/orders and
// /admin/subscriptions tables.
//
// They answer the one question Sunny asks at 5am: how many loaves of each
// kind do I have to bake? Both strips recompute from the SAME filtered
// array their table renders — never a separate query — so the numbers
// cannot disagree with what the operator is scrolling. That is the whole
// point of the strip; a second source would let it lie about the bake.
//
// ONE SHELL, TWO AGGREGATORS. `CountStrip` below is the only markup.
// Orders and subscriptions differ in their data, not their look:
//   - orders  → items[].name    × (qty ?? quantity)
//   - subs    → items[].product_slug × quantity_per_delivery
// so each board brings its own aggregator and shares the presentation.
//
// Orders rules:
//   - "loaves" = sum of (items[].qty || items[].quantity) grouped by
//     item.name. An order for 2 loaves counts 2 loaves.
//   - "orders" = distinct order ids that contained at least one line of
//     that product. Two lines of the same product on one order count 1
//     order.
//   - Cancelled orders are excluded entirely (they will not be baked).
//   - No hardcoded product list — group names are whatever appears in
//     the filtered items, alphabetically sorted so the row order is
//     stable frame-to-frame.
//   - Empty filtered set → render nothing (no zero-noise strip).

import type { ReactNode } from "react";

import type { AdminOrderRow, AdminSubscriptionRow } from "@/lib/admin-shared";
import { variantLabel } from "@/lib/order-share-message";
import {
  isOrderFulfilled,
  isSubscriptionFulfilled,
} from "@/lib/order-fulfillment";
import { subscriptionItems } from "@/lib/subscription-display";
import { ZONE_LABELS, type ZoneKey } from "@/lib/delivery-zones";

type ProductAgg = { name: string; loaves: number; orders: number };

function itemQty(it: { qty?: number | null; quantity?: number | null }): number {
  // TWO LIVE SCHEMAS in orders.items, and `qty` is the OLDER one:
  //   old: {"qty": 1, "slug": "multigrain"}          — still the majority
  //   new: {"quantity": 1, "product_id": "high-protein"} — since 16 Sep 2026
  // Only one of the two keys is ever present on a given line, so the
  // coalesce order is not a preference, it is a union. Reading `qty`
  // alone returns nothing on the new shape and silently under-bakes.
  // Anything not a positive finite number is treated as zero — a
  // 0-loaf line is not baked, and a NaN line must not poison the sum.
  const raw = it.qty ?? it.quantity ?? 0;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function aggregateProduction(orders: AdminOrderRow[]): {
  rows: ProductAgg[];
  totalLoaves: number;
} {
  const byName = new Map<string, { loaves: number; orderIds: Set<string> }>();

  for (const o of orders) {
    if ((o.status ?? "").toLowerCase() === "cancelled") continue;
    const items = o.items ?? [];
    for (const it of items) {
      const name = (it?.name ?? "").trim();
      if (!name) continue;
      const q = itemQty(it);
      if (q === 0) continue;
      const entry = byName.get(name) ?? { loaves: 0, orderIds: new Set<string>() };
      entry.loaves += q;
      entry.orderIds.add(o.id);
      byName.set(name, entry);
    }
  }

  const rows = Array.from(byName.entries())
    .map(([name, v]) => ({ name, loaves: v.loaves, orders: v.orderIds.size }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const totalLoaves = rows.reduce((s, r) => s + r.loaves, 0);
  return { rows, totalLoaves };
}

// ── The shell ───────────────────────────────────────────────────────
//
// Presentation only. Chips are already labelled and counted by the
// caller's aggregator; this renders them and whatever summary the board
// wants on the right.

type Chip = { key: string; label: string; value: number; title?: string };

function CountStrip({
  ariaLabel,
  eyebrow,
  chips,
  trailing,
}: {
  ariaLabel: string;
  eyebrow: string;
  chips: Chip[];
  trailing: ReactNode;
}) {
  return (
    <section
      aria-label={ariaLabel}
      style={{
        margin: "0 0 12px",
        padding: "10px 14px",
        border: "1px solid rgba(251,243,212,0.18)",
        borderRadius: 6,
        background: "rgba(251,243,212,0.04)",
        color: "#FBF3D4",
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
        {eyebrow}
      </span>
      {chips.map((c, i) => (
        <span
          key={c.key}
          title={c.title}
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
          <strong style={{ fontWeight: 500 }}>{c.label}</strong>
          <span style={{ color: "rgba(251,243,212,0.75)" }}>{c.value}</span>
        </span>
      ))}
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
        {trailing}
      </span>
    </section>
  );
}

// ── Orders ──────────────────────────────────────────────────────────

export function ProductionCountStrip({
  orders,
  zone,
}: {
  orders: AdminOrderRow[];
  /** When provided, the strip prefixes itself with the zone label. Used
   *  when the caller is rendering one strip per zone under an active zone
   *  filter — each strip aggregates only the rows for that zone, so a
   *  zoned bake plan cannot silently combine two zones' loaves. */
  zone?: ZoneKey;
}) {
  const { rows, totalLoaves } = aggregateProduction(orders);

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

  // Display-only compaction: aggregation still groups by full item name
  // (Postgres cares), but the strip renders variantLabel — "Multigrain",
  // not "Protein Bread — Multigrain". Sunny reads this at 5am; a bake
  // decision doesn't need the product family repeated on every row. The
  // order count moves into a title tooltip so it's one hover away but
  // stops competing with the loaf number that actually drives baking.
  return (
    <CountStrip
      ariaLabel="Production count for current filter"
      eyebrow={`Bake${zone ? ` · ${ZONE_LABELS[zone]}` : ""}`}
      chips={rows.map((r) => ({
        key: r.name,
        label: variantLabel(r.name),
        value: r.loaves,
        title: `${r.orders} order${r.orders === 1 ? "" : "s"}`,
      }))}
      trailing={
        <>
          {rows.length > 0 ? <span>{totalLoaves} loaves total</span> : null}
          <span style={{ color: "rgba(251,243,212,0.85)" }}>
            {fulfilledOrders} of {totalOrders} fulfilled
          </span>
        </>
      }
    />
  );
}

// ── Subscriptions ───────────────────────────────────────────────────
//
// The same question on the other board: how much bread does this slice of
// plans represent? Counted in LOAVES, not plans — a plan for 2 multigrain
// a delivery is 2 loaves.
//
// THE SKU TRAP. Plain's slug is "high-protein", NOT "plain". Matching on
// "plain" returns zero and the board quietly reports half the bake. Any
// slug that is neither known lands in an explicit OTHER chip rather than
// being dropped, so a new SKU shows up as a number nobody recognises
// instead of as bread that never gets baked.

const LOAF_BUCKETS = ["multigrain", "plain", "other"] as const;
type LoafBucket = (typeof LOAF_BUCKETS)[number];

const LOAF_BUCKET_LABEL: Record<LoafBucket, string> = {
  multigrain: "Multigrain",
  plain: "Plain",
  other: "Other",
};

function loafBucket(slug: string): LoafBucket {
  const s = slug.trim().toLowerCase();
  if (s === "multigrain") return "multigrain";
  if (s === "high-protein") return "plain";
  return "other";
}

export function aggregateSubscriptionLoaves(subs: AdminSubscriptionRow[]): {
  rows: { bucket: LoafBucket; loaves: number }[];
  totalLoaves: number;
} {
  const byBucket: Record<LoafBucket, number> = {
    multigrain: 0,
    plain: 0,
    other: 0,
  };
  // Counted independently of the buckets so the partition can be checked
  // rather than assumed — see the assertion below.
  let totalLoaves = 0;

  for (const s of subs) {
    // A cancelled plan is not bread. Cancelled DELIVERY rows are already
    // gone before we get here: admin-subscription-derive.ts builds
    // delivery_dates from non-cancelled rows only, so a plan whose stop
    // on the filtered day was cancelled never reaches the filtered set.
    if (s.status === "cancelled") continue;
    for (const it of subscriptionItems(s)) {
      const q = Number(it.quantity_per_delivery);
      if (!Number.isFinite(q) || q <= 0) continue;
      const loaves = Math.floor(q);
      // Legacy rows with no subscription_items get a synthesised line
      // with an empty slug; fall back to the plan's own slug before
      // giving up and calling it Other.
      byBucket[loafBucket(it.product_slug || s.product_slug || "")] += loaves;
      totalLoaves += loaves;
    }
  }

  const sum = LOAF_BUCKETS.reduce((n, b) => n + byBucket[b], 0);
  if (process.env.NODE_ENV !== "production" && sum !== totalLoaves) {
    // eslint-disable-next-line no-console
    console.warn(
      `[admin/subscriptions] loaf partition mismatch: ${sum} vs ${totalLoaves}`,
    );
  }

  return {
    rows: LOAF_BUCKETS.filter((b) => byBucket[b] > 0).map((b) => ({
      bucket: b,
      loaves: byBucket[b],
    })),
    totalLoaves,
  };
}

export function SubscriptionLoafCountStrip({
  subs,
  perDelivery,
  zone,
}: {
  subs: AdminSubscriptionRow[];
  /** True when NO day filter is active, i.e. the number is one delivery's
   *  worth per plan and NOT the whole plan's output. Says so out loud —
   *  an unqualified "31 loaves" would be read as the bake for a day. */
  perDelivery: boolean;
  zone?: ZoneKey;
}) {
  const { rows, totalLoaves } = aggregateSubscriptionLoaves(subs);

  const totalSubs = subs.length;
  const fulfilledSubs = subs.reduce(
    (n, s) => (isSubscriptionFulfilled(s) ? n + 1 : n),
    0,
  );

  if (rows.length === 0 && totalSubs === 0) return null;

  return (
    <CountStrip
      ariaLabel="Loaf count for current filter"
      eyebrow={`Bake${zone ? ` · ${ZONE_LABELS[zone]}` : ""}`}
      chips={rows.map((r) => ({
        key: r.bucket,
        label: LOAF_BUCKET_LABEL[r.bucket],
        value: r.loaves,
      }))}
      trailing={
        <>
          {rows.length > 0 ? (
            <span>
              {totalLoaves} loaves {perDelivery ? "per delivery" : "total"}
            </span>
          ) : null}
          <span style={{ color: "rgba(251,243,212,0.85)" }}>
            {fulfilledSubs} of {totalSubs} fulfilled
          </span>
        </>
      }
    />
  );
}
