// Server component. Fetches live product availability from the
// Supabase products table (filtered by is_active=true, is_archived=
// false) and passes it down so the catalogue can hide archived rows
// and badge out-of-stock items. Falls back to "everything live" when
// the DB read returns nothing (network/RLS hiccup) so the shop never
// goes dark.

import { getProductAvailability } from "@/lib/products";

import ShopListClient from "./ShopListClient";

export default async function ShopPage() {
  const availability = await getProductAvailability();
  return <ShopListClient availability={availability} />;
}
