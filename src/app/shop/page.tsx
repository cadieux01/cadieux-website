// Server component. Fetches live product availability from the
// Supabase products table (filtered by is_active=true, is_archived=
// false) and passes it down so the catalogue can hide archived rows
// and badge out-of-stock items. Falls back to "everything live" when
// the DB read returns nothing (network/RLS hiccup) so the shop never
// goes dark.

import { getActiveProducts, getProductAvailability } from "@/lib/products";

import ShopListClient from "./ShopListClient";

export default async function ShopPage() {
  const availability = await getProductAvailability();
  // Live DB price per slug — the single source of truth shown on the
  // catalogue and snapshotted into the cart. Both calls share the same
  // 60s-cached getActiveProducts() read, so this is no extra DB hit.
  const products = await getActiveProducts();
  const priceBySlug: Record<string, number> = {};
  for (const p of products) priceBySlug[p.slug] = p.price_inr;
  return <ShopListClient availability={availability} priceBySlug={priceBySlug} />;
}
