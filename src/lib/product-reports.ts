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
        "id, product_id, title, category, file_url, file_name, mime_type, file_size_bytes, storage_path, sort_order, is_archived, uploaded_at, archived_at",
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
