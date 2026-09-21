// Customer-facing read of the sandwich catalogue.
//
// Same source-of-truth as the admin surface (public.sandwiches +
// public.sandwich_variants), but shaped for the storefront:
//
//   • Only rows with is_available=true reach the customer. An admin can toggle
//     ONE sandwich off without deleting it — the row stays in the admin list,
//     never on /sandwiches. Same for variants: an out-of-stock bread on an
//     otherwise-listed sandwich is dropped from that item's bread choices.
//   • Bread slugs are joined against storefront names locally (see
//     `BREAD_LABELS`). We deliberately do NOT hit `public.products` for this:
//     the sandwich catalogue lists exactly two breads today, both of which
//     have stable storefront names ("Plain" / "Multigrain"). A future third
//     bread ships with a code change to this map — cheaper than a per-page
//     join whose result is 100% predictable.
//   • Ordering: sort_order asc, then name asc. Ties broken deterministically
//     so a two-render diff never reshuffles the menu on the same DB.
//
// The result is cached for 30 s behind SANDWICH_MENU_TAG. The admin CRUD
// routes call `revalidateTag(SANDWICH_MENU_TAG)` on write so an admin
// availability flip is visible immediately. The kitchen switch has its own
// tag — do not conflate them.
//
// Tables sit behind RLS with grants revoked, so this reader uses
// service_role. Nothing here is sensitive (menu + prices are shown to the
// customer anyway) — the RLS-off-with-service-role model is about isolation
// from Postgres roles, not from human readers.

import { unstable_cache } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SANDWICH_MENU_TAG = "sandwich-menu";

/** Storefront labels for the two bread slugs the seed uses today. The customer
 *  knows the `high-protein` loaf as "Plain" (matches its /shop tile). Any new
 *  bread slug landing here without a mapped label falls back to the raw slug —
 *  wrong but visible, better than crashing the PDP. */
export const BREAD_LABELS: Record<string, string> = {
  "high-protein": "Plain",
  multigrain: "Multigrain",
};

export function breadLabelFor(slug: string): string {
  return BREAD_LABELS[slug] ?? slug;
}

export type SandwichVariant = {
  id: string;
  breadSlug: string;
  breadLabel: string;
  priceInr: number;
};

export type Sandwich = {
  id: string;
  slug: string;
  name: string;
  category: "veg" | "nonveg";
  description: string | null;
  imageUrl: string | null;
  galleryUrls: string[];
  sortOrder: number;
  variants: SandwichVariant[];
};

let cachedAdmin: SupabaseClient | null = null;
function getAdmin(): SupabaseClient | null {
  if (cachedAdmin) return cachedAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cachedAdmin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedAdmin;
}

type Row = {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string | null;
  image_url: string | null;
  gallery_urls: string[] | null;
  is_available: boolean;
  sort_order: number;
  sandwich_variants:
    | Array<{
        id: string;
        bread_slug: string;
        price_inr: number;
        is_available: boolean;
      }>
    | null;
};

async function readMenu(): Promise<Sandwich[]> {
  const admin = getAdmin();
  if (!admin) return [];
  const { data, error } = await admin
    .from("sandwiches")
    .select(
      "id, slug, name, category, description, image_url, gallery_urls, is_available, sort_order, sandwich_variants(id, bread_slug, price_inr, is_available)",
    )
    .eq("is_available", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    console.warn("[sandwich-menu] read failed:", error.message);
    return [];
  }
  const rows = (data ?? []) as Row[];
  return rows
    .filter((r) => r.category === "veg" || r.category === "nonveg")
    .map<Sandwich>((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      category: r.category as "veg" | "nonveg",
      description: r.description,
      imageUrl: r.image_url,
      galleryUrls: Array.isArray(r.gallery_urls) ? r.gallery_urls : [],
      sortOrder: r.sort_order,
      variants: (r.sandwich_variants ?? [])
        .filter((v) => v.is_available && Number.isFinite(v.price_inr) && v.price_inr > 0)
        .map<SandwichVariant>((v) => ({
          id: v.id,
          breadSlug: v.bread_slug,
          breadLabel: breadLabelFor(v.bread_slug),
          priceInr: v.price_inr,
        }))
        // Deterministic order — Plain before Multigrain in the seed today, but
        // do NOT hardcode: sort by label so the wire order matches how a
        // customer reads the choices left-to-right.
        .sort((a, b) => a.breadLabel.localeCompare(b.breadLabel)),
    }))
    // A sandwich with zero bread variants left is "not orderable today". Drop
    // it from the customer list rather than rendering a card with no CTA.
    .filter((s) => s.variants.length > 0);
}

const getMenuCached = unstable_cache(readMenu, ["sandwich-menu"], {
  revalidate: 30,
  tags: [SANDWICH_MENU_TAG],
});

/** Full customer menu, cached 30 s behind SANDWICH_MENU_TAG. Ordered. */
export async function getSandwichMenu(): Promise<Sandwich[]> {
  return getMenuCached();
}

/** One sandwich by slug, or null. Reads the same cached list — cheaper than a
 *  second round-trip, and the menu is small (19 rows today). */
export async function getSandwichBySlug(slug: string): Promise<Sandwich | null> {
  const list = await getMenuCached();
  return list.find((s) => s.slug === slug) ?? null;
}
