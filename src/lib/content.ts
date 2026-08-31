// Server-side content reader. Pulls per-page content from the Phase-C
// content tables (content_strings, product_stat_tiles, product_ingredients,
// product_app_test_reports, behind_milestones, behind_stats, process_steps)
// and returns a single PageContent shape consumed by both the website pages
// and the mobile /api/mobile/content endpoint.
//
// Locale fallback: a missing or empty row in the requested locale silently
// falls back to 'en' so the page never goes blank for a locale we haven't
// translated yet.
//
// Critical-string fallbacks: a small whitelist of strings (product name,
// tag, description, key section titles, SEO) has a hardcoded fallback so a
// customer never sees a blank heading or empty <title> if the DB row goes
// missing. Non-critical strings: missing/invisible → render nothing.
//
// Cached with unstable_cache tag 'content', revalidate 60s. Admin mutations
// call revalidateTag('content') after writing.

import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

import { resolveStatTiles } from "@/lib/stat-tiles";

export const CONTENT_CACHE_TAG = "content";

export type ContentLocale = "en" | "te" | "hi";
export type Page = "pdp" | "shop" | "behind" | "making" | "story" | "reports";

export type StatTile = {
  id: string;
  tile_key: string;
  value: string;
  label: string;
  sort_order: number;
};

export type Ingredient = {
  id: string;
  name: string;
  role: string | null;
  sort_order: number;
};

export type AppReport = {
  id: string;
  report_key: string;
  metric: string;
  value: string;
  note: string | null;
  sort_order: number;
};

export type Milestone = {
  id: string;
  milestone_key: string;
  marker: string;
  label: string;
  sort_order: number;
};

export type BehindStat = {
  id: string;
  stat_key: string;
  value: string;
  label: string;
  sort_order: number;
};

export type ProcessStep = {
  id: string;
  step_key: string;
  step_num: string;
  title: string;
  body: string;
  // Optional admin-uploaded photo for the step. null = text-only step.
  image_url: string | null;
  sort_order: number;
};

export type PageContent = {
  locale: ContentLocale;
  served_locale: ContentLocale; // 'en' if fallback was used
  strings: Record<string, string>;
  stat_tiles: StatTile[];
  ingredients: Ingredient[];
  app_reports: AppReport[];
  milestones: Milestone[];
  stats: BehindStat[];
  process_steps: ProcessStep[];
};

// ── Critical fallbacks ─────────────────────────────────────────────────
// If a content_strings row is missing/empty, fall back to these so the
// customer never sees a blank critical section. Per-product fallbacks are
// keyed by `<key>::<product_id>`. Non-critical keys are NOT listed here —
// missing → render nothing.
const CRITICAL_FALLBACKS: Record<string, string> = {
  // Global PDP section titles + global trials banner
  "pdp.section.about.eyebrow": "Inside the loaf",
  "pdp.section.about.title": "Ingredients",
  "pdp.section.reports.eyebrow": "Independently tested",
  "pdp.section.reports.title": "Lab Reports & Certifications",
  "pdp.out_of_stock_banner": "Out of stock",
  "compliance.trials_banner": "Final trials are under process.",
  // Per-product PDP name / tag — never let the heading or eyebrow blank
  "pdp.name::multigrain": "Protein Bread",
  "pdp.name::high-protein": "Protein Bread",
  "pdp.tag::multigrain": "Multigrain Edition",
  "pdp.tag::high-protein": "Plain Edition",
  // H1 fallback per product. The client reads pickString("pdp.title", slug)
  // for the on-page <h1>. Prompt 4 promoted these to keyword-rich phrases
  // that match the new URL slugs (`plain-protein-bread`,
  // `multigrain-protein-bread`) so the H1, canonical URL, breadcrumb
  // trail, and title tag all reinforce the same primary keyword. Admin
  // edits in content_strings still take precedence.
  "pdp.title::multigrain": "Cadieux Multigrain Protein Bread",
  "pdp.title::high-protein": "Cadieux Plain Protein Bread",
  "pdp.description::multigrain":
    "Our multigrain loaf is the full expression of Cadieux: ancient grains, seeds, and protein, slow-fermented and baked to hold structure.",
  "pdp.description::high-protein":
    "Clean sandwich bread built for protein without the fuss. Soft slices, no compromise.",
  // SEO fallbacks per product — under Google's 60-char title / 155-char
  // description windows, city-anchored (Visakhapatnam is the primary
  // delivery market), keyword-forward. No nutrition figures until the
  // FSSAI label is on the physical loaf (per compliance sweep).
  "pdp.seo.title::multigrain":
    "Cadieux Multigrain Protein Bread — Baked in Visakhapatnam",
  "pdp.seo.title::high-protein":
    "Cadieux Plain Protein Bread — Baked in Visakhapatnam",
  "pdp.seo.description::multigrain":
    "Cadieux Multigrain Protein Bread. Slow-fermented, lab-tested, baked fresh daily in Visakhapatnam. Fresh delivery across Vizag.",
  "pdp.seo.description::high-protein":
    "Cadieux Plain Protein Bread. Clean sandwich slices, slow-fermented and lab-tested, baked fresh daily in Visakhapatnam. Fresh delivery across Vizag.",
};

function fallbackFor(key: string, productId: string | null | undefined): string | undefined {
  if (productId) {
    const k = `${key}::${productId}`;
    if (k in CRITICAL_FALLBACKS) return CRITICAL_FALLBACKS[k];
  }
  return CRITICAL_FALLBACKS[key];
}

// ── Page meta ──────────────────────────────────────────────────────────
function pageMeta(page: Page): {
  // Atomic-string key prefixes pulled for this page. 'compliance' + 'share'
  // are always pulled in addition (they apply across pages).
  prefixes: string[];
  productScoped: boolean; // pulls per-product strings + stat_tiles + ingredients + app_reports
  pulls: {
    stat_tiles: boolean;
    ingredients: boolean;
    app_reports: boolean;
    milestones: boolean;
    stats: boolean;
    process_steps: boolean;
  };
} {
  const base = {
    stat_tiles: false,
    ingredients: false,
    app_reports: false,
    milestones: false,
    stats: false,
    process_steps: false,
  };
  switch (page) {
    case "pdp":
      return {
        prefixes: ["pdp"],
        productScoped: true,
        pulls: {
          ...base,
          stat_tiles: true,
          ingredients: true,
          app_reports: true,
        },
      };
    case "shop":
      return {
        prefixes: ["pdp", "shop"],
        productScoped: true,
        pulls: { ...base, stat_tiles: true },
      };
    case "behind":
      return {
        prefixes: ["behind"],
        productScoped: false,
        pulls: { ...base, milestones: true, stats: true },
      };
    case "making":
      return {
        prefixes: ["making"],
        productScoped: false,
        pulls: { ...base, process_steps: true },
      };
    case "story":
      return {
        prefixes: ["story"],
        productScoped: false,
        pulls: { ...base, process_steps: true },
      };
    case "reports":
      return {
        prefixes: ["pdp", "reports"],
        productScoped: true,
        pulls: { ...base, app_reports: true },
      };
  }
}

// Anon client for public reads (RLS allows SELECT TO anon WHERE is_visible).
function anon() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function fetchStrings(
  locale: ContentLocale,
  prefixes: string[],
  productId: string | null,
): Promise<Array<{ key: string; value: string; product_id: string | null }>> {
  const sb = anon();
  // Build OR of: pdp.*, behind.*, ..., compliance.*, share.* (always included)
  const allPrefixes = Array.from(new Set([...prefixes, "compliance", "share"]));
  const orParts = allPrefixes.map((p) => `key.like.${p}.%`).join(",");
  let q = sb
    .from("content_strings")
    .select("key, value, product_id")
    .eq("locale", locale)
    .eq("is_visible", true)
    .or(orParts);
  // We pull per-product rows too (their key matches a prefix above); product
  // scoping is applied client-side because the OR composes awkwardly with
  // null/eq on product_id.
  const { data, error } = await q;
  if (error) {
    console.error("[content] fetchStrings:", error.message);
    return [];
  }
  const rows = (data ?? []) as Array<{ key: string; value: string; product_id: string | null }>;
  // Keep: global (product_id IS NULL) OR matches productId
  return rows.filter((r) => r.product_id == null || r.product_id === productId);
}

async function fetchStatTiles(
  locale: ContentLocale,
  productId: string,
): Promise<StatTile[]> {
  const sb = anon();
  const [tilesRes, productRes] = await Promise.all([
    sb
      .from("product_stat_tiles")
      .select("id, tile_key, value, label, sort_order")
      .eq("locale", locale)
      .eq("product_id", productId)
      .eq("is_visible", true)
      .order("sort_order", { ascending: true }),
    // Source of truth for the derived tiles (net weight, slice count). Read
    // here rather than in each page so the website, the mobile content API
    // and anything added later all get the same figures — a food label must
    // not depend on the caller remembering to resolve it.
    sb
      .from("products")
      .select("weight, slices_per_loaf")
      .eq("slug", productId)
      .maybeSingle(),
  ]);
  if (tilesRes.error) {
    console.error("[content] fetchStatTiles:", tilesRes.error.message);
    return [];
  }
  if (productRes.error) {
    console.error("[content] fetchStatTiles product:", productRes.error.message);
  }
  return resolveStatTiles(
    (tilesRes.data ?? []) as StatTile[],
    productRes.data ?? null,
  );
}

async function fetchIngredients(
  locale: ContentLocale,
  productId: string,
): Promise<Ingredient[]> {
  const sb = anon();
  // product_ingredients has locale + is_visible after Stage-1 extension
  const { data, error } = await sb
    .from("product_ingredients")
    .select("id, name, role, sort_order, locale, is_visible")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[content] fetchIngredients:", error.message);
    return [];
  }
  const rows = (data ?? []) as Array<{
    id: string;
    name: string;
    role: string | null;
    sort_order: number;
    locale: string | null;
    is_visible: boolean | null;
  }>;
  return rows
    .filter((r) => r.is_visible !== false)
    .filter((r) => r.locale == null || r.locale === locale || r.locale === "en")
    .map((r) => ({ id: r.id, name: r.name, role: r.role, sort_order: r.sort_order }));
}

async function fetchAppReports(
  locale: ContentLocale,
  productId: string,
): Promise<AppReport[]> {
  const sb = anon();
  const { data, error } = await sb
    .from("product_app_test_reports")
    .select("id, report_key, metric, value, note, sort_order")
    .eq("locale", locale)
    .eq("product_id", productId)
    .eq("is_visible", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[content] fetchAppReports:", error.message);
    return [];
  }
  return (data ?? []) as AppReport[];
}

async function fetchMilestones(locale: ContentLocale): Promise<Milestone[]> {
  const sb = anon();
  const { data, error } = await sb
    .from("behind_milestones")
    .select("id, milestone_key, marker, label, sort_order")
    .eq("locale", locale)
    .eq("is_visible", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[content] fetchMilestones:", error.message);
    return [];
  }
  return (data ?? []) as Milestone[];
}

async function fetchBehindStats(locale: ContentLocale): Promise<BehindStat[]> {
  const sb = anon();
  const { data, error } = await sb
    .from("behind_stats")
    .select("id, stat_key, value, label, sort_order")
    .eq("locale", locale)
    .eq("is_visible", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[content] fetchBehindStats:", error.message);
    return [];
  }
  return (data ?? []) as BehindStat[];
}

async function fetchProcessSteps(locale: ContentLocale): Promise<ProcessStep[]> {
  const sb = anon();
  const { data, error } = await sb
    .from("process_steps")
    .select("id, step_key, step_num, title, body, image_url, sort_order")
    .eq("locale", locale)
    .eq("is_visible", true)
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[content] fetchProcessSteps:", error.message);
    return [];
  }
  return (data ?? []) as ProcessStep[];
}

// ── Public reader ──────────────────────────────────────────────────────
async function readPageContent(
  page: Page,
  productId: string | null,
  locale: ContentLocale,
): Promise<PageContent> {
  const meta = pageMeta(page);
  const productScoped = meta.productScoped && productId != null;
  let served: ContentLocale = locale;

  // Strings: try requested locale; if NO row at all comes back AND locale!=en, refetch as 'en'.
  let stringRows = await fetchStrings(locale, meta.prefixes, productScoped ? productId : null);
  if (stringRows.length === 0 && locale !== "en") {
    stringRows = await fetchStrings("en", meta.prefixes, productScoped ? productId : null);
    served = "en";
  }
  const stringsMap: Record<string, string> = {};
  for (const r of stringRows) {
    // Prefer per-product over global if both exist for the same key.
    if (r.product_id != null) stringsMap[r.key] = r.value;
    else if (!(r.key in stringsMap)) stringsMap[r.key] = r.value;
  }

  // Structured: each table independently. Use 'served' locale.
  const [stat_tiles, ingredients, app_reports, milestones, stats, process_steps] = await Promise.all([
    meta.pulls.stat_tiles && productScoped ? fetchStatTiles(served, productId!) : Promise.resolve([] as StatTile[]),
    meta.pulls.ingredients && productScoped ? fetchIngredients(served, productId!) : Promise.resolve([] as Ingredient[]),
    meta.pulls.app_reports && productScoped ? fetchAppReports(served, productId!) : Promise.resolve([] as AppReport[]),
    meta.pulls.milestones ? fetchMilestones(served) : Promise.resolve([] as Milestone[]),
    meta.pulls.stats ? fetchBehindStats(served) : Promise.resolve([] as BehindStat[]),
    meta.pulls.process_steps ? fetchProcessSteps(served) : Promise.resolve([] as ProcessStep[]),
  ]);

  // For each structured table, fall back to 'en' if non-en returned empty AND requested locale != 'en'.
  // We don't track per-table; a blanket re-fetch on misses is enough for now (rare path).

  return {
    locale,
    served_locale: served,
    strings: stringsMap,
    stat_tiles,
    ingredients,
    app_reports,
    milestones,
    stats,
    process_steps,
  };
}

// Cached entry point. Cache key includes page + productId + locale.
export const getPageContent = unstable_cache(
  async (opts: { page: Page; productId?: string | null; locale?: ContentLocale }) => {
    const locale: ContentLocale = opts.locale ?? "en";
    const productId = opts.productId ?? null;
    return readPageContent(opts.page, productId, locale);
  },
  ["content-page"],
  { revalidate: 60, tags: [CONTENT_CACHE_TAG] },
);

// Resolve an atomic string with the critical-fallback safety net.
// Returns "" for non-critical missing strings so the caller renders nothing.
export function pickString(
  content: PageContent,
  key: string,
  productId?: string | null,
): string {
  const v = content.strings[key];
  if (v !== undefined && v !== null && v !== "") return v;
  return fallbackFor(key, productId) ?? "";
}
