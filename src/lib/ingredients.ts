// Per-product ingredient list. Stored in Supabase table
// `product_ingredients` (product_id == products.id == slug).
//
// Public reads (PDP) go through `getProductIngredients(productSlug)` which
// is cached with tag "product-ingredients" so the admin can bust it after
// writes. Admin reads/writes use service-role via API routes — see
// /api/admin/products/[id]/ingredients.

import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

export const PRODUCT_INGREDIENTS_TAG = "product-ingredients";

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// 60s cache, shared tag. Admin writes call revalidateTag("product-ingredients").
// products.id == slug, so the PDP slug is the product_id directly.
export const getProductIngredients = unstable_cache(
  async (productSlug: string): Promise<string[]> => {
    const { data, error } = await supabaseAnon
      .from("product_ingredients")
      .select("name, sort_order")
      .eq("product_id", productSlug)
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("[lib/ingredients] fetch failed:", error);
      return [];
    }
    return (data ?? []).map((r) => r.name as string);
  },
  ["product-ingredients-by-product"],
  { revalidate: 60, tags: [PRODUCT_INGREDIENTS_TAG] },
);
