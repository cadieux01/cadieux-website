// Reading one line out of `orders.items` — which is written in TWO SHAPES.
//
// THE SCHEMA SPLIT. `orders.items` is jsonb with no constraint, and two
// clients write it with different key names for the same two facts:
//
//   A — website checkout   { slug, qty,      name, price_inr,      line_total      }
//   B — mobile app         { product_id, quantity, name, unit_price_inr, line_total_inr }
//
// Measured on prod 2026-09-22: 374 lines in shape A, 13 in shape B. Shape B
// is NOT legacy — the app wrote OLF293 at 17:06 IST and OLF301 at 19:44 IST
// that same day, alongside OLF219 (16 Sep) and OLF236 (17 Sep). Anything
// reading this column has to handle both, indefinitely, until the app is
// changed and its old installs age out.
//
// WHY slug ?? product_id AND NOT A NAME MATCH. The two key columns carry
// the IDENTICAL vocabulary — 'high-protein', 'multigrain', 'burger-bun' —
// with zero divergence across all 387 lines on prod. So the coalesce is
// exact and lossless, and it never has to parse a display string. Matching
// on `name` also works today, but `name` is prose a human edits: the Plain
// loaf has already been renamed once (fix/protein-bread-rename), and a
// rename silently splits one product into two buckets rather than failing.
// Identity comes from the id columns; `name` is for humans only.
//
// WHAT A SLUG-ONLY READ COSTS, MEASURED. The burger bun shipped on
// 2026-09-22 with 5 orders / 9 units. Three carry `slug`, two carry only
// `product_id` (OLF293 ×2, OLF301 ×1). Reading `slug` alone reports
// 6 units across 3 orders — a third of the buns and two of the five orders
// silently missing, the two most recent of them.
//
// Subscriptions are a third shape again (`product_name` /
// `quantity_per_delivery`, from public.subscription_items, whose
// `product_slug` column is 100% populated with the same vocabulary) — see
// readItem() in lib/bake-plan-lines.ts, which normalises that side.

/** Every key either client has ever written for identity or quantity.
 *  Deliberately all-optional: a caller passes whatever it has and the
 *  readers below decide, so no call site repeats the coalesce order. */
export type OrderItemLike = {
  slug?: string | null;
  product_id?: string | null;
  product_slug?: string | null;
  name?: string | null;
  qty?: number | null;
  quantity?: number | null;
};

/**
 * Stable identity for one line, or null when the line carries none.
 *
 * NEVER falls back to `name`. A line with no id column is genuinely
 * unidentified, and saying so lets the caller render it as unknown rather
 * than guess it into a bucket — the failure mode this whole module exists
 * to remove. There are no such lines on prod today.
 */
export function itemSlug(it: OrderItemLike | null | undefined): string | null {
  const raw = it?.slug ?? it?.product_id ?? it?.product_slug;
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return s || null;
}

/**
 * Units on one line. `qty` (web) before `quantity` (app); anything that is
 * not a positive finite number is zero, because a 0-unit line is not baked
 * and a NaN must never poison a sum. Floored — half a loaf is not a thing.
 */
export function itemQty(it: OrderItemLike | null | undefined): number {
  const raw = it?.qty ?? it?.quantity ?? 0;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
