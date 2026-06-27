// Seeds the Phase-C content tables (content_strings, product_stat_tiles,
// product_app_test_reports) with empty / placeholder rows when a new
// product is created via POST /api/admin/products.
//
// Rationale: the public website + mobile app render product pages through
// `getPageContent()` (lib/content.ts), which reads from these tables. If a
// new product has zero seed rows, the operator must visit each content tab
// manually before the PDP looks complete. Seeding placeholders means the
// row layout is immediately consistent across products and the admin only
// needs to fill in the values that vary.
//
// Numerics deliberately use "—" (em-dash) — DO NOT seed any nutrition
// figures. Lab trials are still in progress; printing speculative numbers
// would create a compliance risk. The operator promotes the placeholder
// to a real value once labs return.

import { supabaseAdmin } from "@/lib/admin-auth";

// Empty content_strings rows keyed by the PDP fields the website + app
// expect. Empty `value` is allowed (column is nullable); admin can fill
// these in via /admin/content. Critical fallbacks in lib/content.ts will
// substitute brand copy until then.
const DEFAULT_STRING_KEYS = [
  "pdp.name",
  "pdp.tag",
  "pdp.tagline",
  "pdp.description",
  "pdp.seo.title",
  "pdp.seo.description",
] as const;

// Default 4 tiles mirror the existing multigrain / high-protein layout
// (protein_per_slice, fiber_per_slice, slices, net_weight). All numerics
// "—" so nothing speculative is published before lab trials complete.
const DEFAULT_TILES: Array<{
  tile_key: string;
  label: string;
  value: string;
  sort_order: number;
}> = [
  {
    tile_key: "protein_per_slice",
    label: "Protein / slice",
    value: "—",
    sort_order: 0,
  },
  {
    tile_key: "fiber_per_slice",
    label: "Fibre / slice",
    value: "—",
    sort_order: 1,
  },
  { tile_key: "slices", label: "Slices", value: "—", sort_order: 2 },
  { tile_key: "net_weight", label: "Net weight", value: "—", sort_order: 3 },
];

// One placeholder lab-report row so /reports/[slug] doesn't render an empty
// state for a brand-new product. Admin replaces this with real lab metrics
// (per batch) via /admin/products/[id] → Lab Reports tab.
const DEFAULT_APP_REPORT: {
  report_key: string;
  metric: string;
  value: string;
  note: string | null;
  sort_order: number;
} = {
  report_key: "placeholder",
  metric: "Awaiting lab",
  value: "—",
  note: "Replace once batch results arrive.",
  sort_order: 0,
};

/** Insert default empty/placeholder content rows for a newly-created
 *  product. Idempotent in the sense that callers should only call once
 *  per create — but on collision (e.g. retries) we swallow the unique
 *  violation rather than fail the create.
 *
 *  Caller already validated `productId`; we accept it as a free string. */
export async function seedDefaultProductContent(productId: string): Promise<void> {
  const locale = "en";

  // content_strings — 6 PDP keys, blank value. is_visible=true (default).
  const stringRows = DEFAULT_STRING_KEYS.map((key) => ({
    product_id: productId,
    key,
    locale,
    value: null as string | null,
  }));
  const { error: sErr } = await supabaseAdmin
    .from("content_strings")
    .insert(stringRows);
  if (sErr) {
    // 23505 = unique_violation — seeding raced, ignore.
    if (sErr.code !== "23505") {
      console.warn(
        "[admin/products seed] content_strings insert failed:",
        sErr.message,
      );
    }
  }

  // product_stat_tiles — 4 default tiles, numerics "—".
  const tileRows = DEFAULT_TILES.map((t) => ({
    product_id: productId,
    locale,
    tile_key: t.tile_key,
    value: t.value,
    label: t.label,
    sort_order: t.sort_order,
  }));
  const { error: tErr } = await supabaseAdmin
    .from("product_stat_tiles")
    .insert(tileRows);
  if (tErr) {
    if (tErr.code !== "23505") {
      console.warn(
        "[admin/products seed] product_stat_tiles insert failed:",
        tErr.message,
      );
    }
  }

  // product_app_test_reports — 1 placeholder row, value "—".
  const { error: rErr } = await supabaseAdmin
    .from("product_app_test_reports")
    .insert([
      {
        product_id: productId,
        locale,
        report_key: DEFAULT_APP_REPORT.report_key,
        metric: DEFAULT_APP_REPORT.metric,
        value: DEFAULT_APP_REPORT.value,
        note: DEFAULT_APP_REPORT.note,
        sort_order: DEFAULT_APP_REPORT.sort_order,
      },
    ]);
  if (rErr) {
    if (rErr.code !== "23505") {
      console.warn(
        "[admin/products seed] product_app_test_reports insert failed:",
        rErr.message,
      );
    }
  }
}
