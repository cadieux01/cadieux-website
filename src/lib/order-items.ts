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
  /** Declared only so a caller's whole line is assignable. Nothing here
   *  reads it — see the note above on why identity never comes from a name —
   *  and it is `unknown` because jsonb makes no promise that it is a string. */
  name?: unknown;
  qty?: number | null;
  quantity?: number | null;
  line_total?: number | string | null;
  line_total_inr?: number | string | null;
  price_inr?: number | string | null;
  unit_price_inr?: number | string | null;
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

/**
 * The UNIT price on one line, or null when the line carries none.
 *
 * Unlike itemLineTotal below, the ordering here carries no hazard: both keys
 * mean the identical thing (price of one unit), so the pair is a pure rename
 * and either order is lossless. Shape A's `price_inr` comes first only to
 * match the probability of seeing it.
 *
 * SEPARATE FROM itemLineTotal ON PURPOSE. A receipt prints unit price and
 * line total as two columns, and the fallback chain that is correct for the
 * line total (try both line totals BEFORE either unit price) would make this
 * reader return a 2-unit line's full total as its unit price.
 */
export function itemUnitPrice(
  it: OrderItemLike | null | undefined,
): number | null {
  const raw = it?.price_inr ?? it?.unit_price_inr;
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * The name the customer saw when they ordered, or null.
 *
 * THE ONE PLACE `name` IS LEGITIMATELY READ, and it does not contradict the
 * header's rule that identity never comes from a name. This is the opposite
 * direction: not "which product is this" (itemSlug answers that) but "what
 * words were on the screen when this line was bought". For a receipt the
 * stored string is the MORE correct of the two sources — the Plain loaf has
 * been renamed once already, and a receipt reprinted after a rename should
 * still say what the customer actually bought.
 *
 * `unknown` in the type because jsonb makes no promise, hence the typeof
 * guard rather than a cast.
 */
export function itemName(it: OrderItemLike | null | undefined): string | null {
  const raw = it?.name;
  const s = typeof raw === "string" ? raw.trim() : "";
  return s || null;
}

/**
 * Money on one line, or null when the line carries none.
 *
 * BOTH LINE TOTALS ARE TRIED BEFORE EITHER UNIT PRICE, because the fallback
 * is lossy: a unit price on a 2-unit line under-reports the line by half.
 * Ordering within a pair is arbitrary — no line on prod has ever carried keys
 * from both shapes — but across pairs it is not, and shape A's `price_inr`
 * sitting ahead of shape B's `line_total_inr` would be exactly that bug.
 *
 * Every line on prod today carries a line total, so the unit-price fallback is
 * defensive only; it is kept because the alternative is printing no amount at
 * all, and it is NOT multiplied by the quantity — inventing a total the
 * database never stored is worse than reporting the one number it did.
 */
export function itemLineTotal(
  it: OrderItemLike | null | undefined,
): number | null {
  const raw =
    it?.line_total ?? it?.line_total_inr ?? it?.price_inr ?? it?.unit_price_inr;
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}
