// Product DISPLAY names, resolved by slug against the catalogue.
//
// WHY THIS EXISTS. A product name appears in three kinds of place and only
// one of them is a label:
//
//   1. public.products.name — the catalogue. The current name. THE LABEL.
//   2. orders.items[].name, subscription_items.product_name,
//      subscriptions.bread_name — SNAPSHOTS, written at checkout and never
//      rewritten. Counted on prod 2026-09-23: 297 orders rows, 54
//      subscription_items rows and 45 subscriptions.bread_name rows still
//      say "Protein Bread — Plain" or "Protein Bread — Multigrain".
//   3. hardcoded strings in the bundled catalogue (@/lib/data PRODUCTS) —
//      a fallback for when Supabase is dark, documented there as having to
//      match the DB.
//
// The snapshots keep the old text ON PURPOSE: an invoice, a share message
// and an audit row must say what the customer was actually sold. They are
// history, not labels. Rendering them on an admin board means the board
// disagrees with the catalogue the moment anything is renamed — which is
// exactly what the 2026-09-23 rename would have done to every one of those
// 396 rows.
//
// So: anything DISPLAYING a product resolves slug -> name through here.
// Anything RECORDING what was sold keeps reading its own snapshot.
//
// The key is the slug, obtained via `itemSlug()` (see lib/order-items.ts)
// because orders.items is written in two different jsonb shapes.

export type ProductNameMap = Record<string, string>;

/**
 * slug -> catalogue name, mirroring `public.products.name`.
 *
 * This is the FALLBACK, not the source: surfaces that can reach the DB pass
 * a live map to `productDisplayName` and this is what they render before it
 * arrives (and if it never does). Values MUST match the DB rows — same
 * contract as PRODUCTS in @/lib/data, which is the bundled copy of the same
 * catalogue.
 *
 * Verified against prod 2026-09-23. `products.id` and `products.slug` are
 * both text and hold the same value, so either column can key this.
 */
export const PRODUCT_NAMES: ProductNameMap = {
  "high-protein": "Protein Bread",
  multigrain: "Multigrain Protein Bread",
  "burger-bun": "Protein Burger Bun",
};

/**
 * The name to show for a product.
 *
 * @param slug     identity of the line — `itemSlug(item)`, never its name.
 * @param live     slug -> name read from the catalogue this session, when
 *                 the caller has one. Wins over the bundled copy so a
 *                 rename shows up without a deploy.
 * @param snapshot the line's own stored name. Used ONLY when the slug is
 *                 absent from both maps, i.e. the line is for something
 *                 that is not in the catalogue at all — there the stored
 *                 string is not stale history, it is the only description
 *                 that exists. A known product never reaches it.
 */
export function productDisplayName(
  slug: string | null | undefined,
  live?: ProductNameMap | null,
  snapshot?: string | null,
): string {
  const key = String(slug ?? "").trim().toLowerCase();
  if (key) {
    const fromLive = live?.[key]?.trim();
    if (fromLive) return fromLive;
    const fromBundle = PRODUCT_NAMES[key];
    if (fromBundle) return fromBundle;
  }
  const fromSnapshot = String(snapshot ?? "").trim();
  return fromSnapshot || key || "Item";
}

/**
 * Build the live map from a `[{ id, name }]` payload.
 *
 * Shaped for GET /api/admin/products/availability, which already returns
 * exactly that for every product and is already admin-gated and live-read.
 * Reusing it keeps this to one request the orders board was going to make
 * anyway rather than a second endpoint saying the same thing.
 */
export function productNameMap(
  rows: Array<{ id?: unknown; slug?: unknown; name?: unknown }> | null | undefined,
): ProductNameMap {
  const out: ProductNameMap = {};
  for (const r of rows ?? []) {
    const key = String(r?.slug ?? r?.id ?? "").trim().toLowerCase();
    const name = String(r?.name ?? "").trim();
    if (key && name) out[key] = name;
  }
  return out;
}
