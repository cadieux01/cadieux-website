"use client";

// Production-count summary strip shown above the /admin/orders table.
//
// It answers the one question Sunny asks at 5am: how many loaves of each
// kind do I have to bake, and across how many orders? The strip
// recomputes from the SAME filtered array the table renders — so the
// numbers cannot disagree with what the operator is scrolling.
//
// Rules:
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
//
// The type accepted is intentionally the narrow projection this strip
// needs, not `AdminOrderRow`, so if the row shape ever grows the strip
// stays a leaf.

import type { AdminOrderRow } from "@/lib/admin-shared";
import { variantLabel } from "@/lib/order-share-message";
import { isOrderFulfilled } from "@/lib/order-fulfillment";

type ProductAgg = { name: string; loaves: number; orders: number };

function itemQty(it: { qty?: number | null; quantity?: number | null }): number {
  // Prefer qty (the newer field). Fall back to quantity (legacy).
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

export function ProductionCountStrip({ orders }: { orders: AdminOrderRow[] }) {
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
    <section
      aria-label="Production count for current filter"
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
        Bake
      </span>
      {rows.map((r, i) => {
        const label = variantLabel(r.name);
        return (
          <span
            key={r.name}
            title={`${r.orders} order${r.orders === 1 ? "" : "s"}`}
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
    </section>
  );
}
