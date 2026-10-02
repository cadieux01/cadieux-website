// Per-product lab reports & certifications (FSSAI, nutrition, microbial,
// allergen, other). Stored in Supabase table `product_reports` with files
// in the `product-reports` Storage bucket.
//
// Public reads (PDP) go through `getProductReports(productId)` which is
// cached with tag "product-reports" so the admin can bust it after writes.
// Admin reads/writes use service-role via API routes — see
// /api/admin/products/[id]/reports.

import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

export type ProductReportCategory =
  | "fssai"
  | "nutrition"
  | "microbial"
  | "allergen"
  | "other";

export type ProductReport = {
  id: string;
  product_id: string;
  title: string;
  // Editable display fields (report_name is the heading shown on the PDP;
  // title is kept for back-compat and defaults to report_name on create).
  report_number: string | null;
  report_name: string | null;
  summary: string | null;
  category: ProductReportCategory;
  file_url: string;
  file_name: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  storage_path: string;
  sort_order: number;
  is_archived: boolean;
  uploaded_at: string;
  archived_at: string | null;
};

export const PRODUCT_REPORT_CATEGORY_LABEL: Record<
  ProductReportCategory,
  string
> = {
  fssai: "FSSAI",
  nutrition: "Nutrition",
  microbial: "Microbial",
  allergen: "Allergen",
  other: "Other",
};

export const PRODUCT_REPORT_CATEGORIES: ProductReportCategory[] = [
  "fssai",
  "nutrition",
  "microbial",
  "allergen",
  "other",
];

// ── Borrowed reports ────────────────────────────────────────────────
//
// Some products are made from the SAME dough as another and are covered by
// that product's lab work — the burger bun is protein bread in a different
// shape, so the protein bread's aflatoxin / microbiology / chemical
// analysis are the bun's too. Rather than copy the rows, the borrower's
// PDP reads the SOURCE product's reports.
//
// Copying was the other option and it is the wrong one. This table already
// shows what copies do: `sort_order` is 0 on all six live rows, and the two
// multigrain files still sit under a `high-protein/` storage prefix. Two
// rows for one physical PDF means every re-upload, rename, summary tweak or
// archive has to be done twice, and the day it is done once they disagree
// with no way to tell which is current.
//
// Adding a product that borrows: ONE line below, keyed and valued by
// INTERNAL slug (public.products.slug). A product absent from this map
// shows its own reports, so nothing here needs touching for a product
// with its own lab work.
const REPORT_SOURCE_BY_SLUG: Record<string, string> = {
  "burger-bun": "high-protein",
  // Protein Pizza Base is the protein bread dough rolled flat, so the same
  // aflatoxin / microbiology / chemical analysis covers it.
  //
  // The placeholder that sat here was keyed `protein-pizza-base`, written
  // before the slug was settled. The row is `pizza-base` (products.id and
  // products.slug both), and this map is keyed by the INTERNAL slug — the
  // old spelling would have matched nothing and the PDP would have shown an
  // empty reports section with no error.
  "pizza-base": "high-protein",
};

/** Internal slug whose reports a product's PDP should display. Identity
 *  for any product not in the borrow map. */
export function reportSourceSlug(internalSlug: string): string {
  return REPORT_SOURCE_BY_SLUG[internalSlug] ?? internalSlug;
}

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// 60s cache. Per-product tag so a write to one product's reports
// doesn't invalidate every other product's cache. Admin writes call
// revalidateTag(productReportsTag(productId)).
export function productReportsTag(productId: string): string {
  return `product-reports:${productId}`;
}

export const getProductReports = unstable_cache(
  async (productId: string): Promise<ProductReport[]> => {
    const { data, error } = await supabaseAnon
      .from("product_reports")
      .select(
        "id, product_id, title, report_number, report_name, summary, category, file_url, file_name, mime_type, file_size_bytes, storage_path, sort_order, is_archived, uploaded_at, archived_at",
      )
      .eq("product_id", productId)
      .eq("is_archived", false)
      .order("sort_order", { ascending: true })
      .order("uploaded_at", { ascending: false });

    if (error) {
      console.error("[lib/product-reports] fetch failed:", error);
      return [];
    }
    return (data ?? []) as ProductReport[];
  },
  ["product-reports-by-product"],
  // The tag is fixed at cache build, but per-product invalidation
  // works because we call revalidateTag("product-reports:<id>") AND
  // the umbrella "product-reports" tag from admin writes.
  { revalidate: 60, tags: ["product-reports"] },
);
