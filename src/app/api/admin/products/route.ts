import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import {
  buildAuditEntries,
  slugify,
  writeAuditEntries,
} from "@/lib/admin-product-audit";

// Bust the unstable_cache entries that key off the same product rows.
// "products" is consumed by getActiveProducts() (lib/products.ts).
// "subscription-plans" is consumed by the public subscription-plans
// reader added alongside the SETUP_PRODUCTS refactor — invalidating
// here keeps the wizard in sync with admin price edits.
function bustProductCaches(): void {
  revalidateTag("products");
  revalidateTag("subscription-plans");
}

const PRODUCT_SELECT =
  "id, slug, name, price_inr, subscription_per_loaf_inr, weight, description, tagline, highlights, image_url, is_active, in_stock, is_archived, archived_at, sort_order, updated_at";

// GET /api/admin/products?include_archived=1
//   Returns every product (newest first) so the admin can scroll the
//   full catalogue. Archived rows are filtered out by default; pass
//   `?include_archived=1` to include them.
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("include_archived") === "1";

  let query = supabaseAdmin
    .from("products")
    .select(PRODUCT_SELECT)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (!includeArchived) {
    query = query.eq("is_archived", false);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[admin/products GET]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ products: data ?? [] });
}

// POST /api/admin/products  — create a new product. Body:
//   {
//     name: string,
//     slug?: string,                       // auto-derived from name when missing
//     price_inr: number,
//     subscription_per_loaf_inr?: number,  // defaults to price_inr
//     weight?: string,
//     description?: string,
//     tagline?: string,
//     highlights?: string[],
//     image_url?: string,
//     in_stock?: boolean,                  // default true
//     is_active?: boolean,                 // default true
//     sort_order?: number                  // default max+1
//   }
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const priceRaw = Number(body.price_inr);
  if (!Number.isFinite(priceRaw) || priceRaw < 0) {
    return NextResponse.json(
      { error: "price_inr must be a non-negative number" },
      { status: 400 },
    );
  }
  const slug = (typeof body.slug === "string" && body.slug.trim().length > 0
    ? slugify(body.slug)
    : slugify(name));
  if (!slug) {
    return NextResponse.json(
      { error: "slug could not be derived from name" },
      { status: 400 },
    );
  }

  // Reject duplicate slugs before the unique-index does. Cleaner error.
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("products")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (lookupErr) {
    console.error("[admin/products POST] lookup:", lookupErr.message);
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json(
      { error: `slug "${slug}" already exists` },
      { status: 409 },
    );
  }

  // Compute the default sort_order (max + 1) so new rows land at the end.
  let nextSort = 0;
  if (typeof body.sort_order === "number" && Number.isFinite(body.sort_order)) {
    nextSort = body.sort_order;
  } else {
    const { data: maxRow } = await supabaseAdmin
      .from("products")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    nextSort = (maxRow?.sort_order ?? 0) + 1;
  }

  const insertRow = {
    slug,
    name,
    price_inr: priceRaw,
    subscription_per_loaf_inr:
      typeof body.subscription_per_loaf_inr === "number"
        ? body.subscription_per_loaf_inr
        : priceRaw,
    weight: typeof body.weight === "string" ? body.weight : null,
    description:
      typeof body.description === "string" ? body.description : null,
    tagline: typeof body.tagline === "string" ? body.tagline : null,
    highlights: Array.isArray(body.highlights)
      ? body.highlights.filter((h: unknown) => typeof h === "string")
      : [],
    image_url:
      typeof body.image_url === "string" && body.image_url.length > 0
        ? body.image_url
        : null,
    in_stock: typeof body.in_stock === "boolean" ? body.in_stock : true,
    is_active: typeof body.is_active === "boolean" ? body.is_active : true,
    is_archived: false,
    sort_order: nextSort,
  };

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("products")
    .insert(insertRow)
    .select(PRODUCT_SELECT)
    .single();

  if (insertErr || !inserted) {
    console.error("[admin/products POST] insert:", insertErr?.message);
    return NextResponse.json(
      { error: insertErr?.message ?? "Insert failed" },
      { status: 500 },
    );
  }

  // Audit: one row per non-default field so the history page can show
  // exactly what the creator set. We pass an empty "before" so every
  // explicit value shows as a transition from null.
  const entries = buildAuditEntries(
    inserted.id,
    inserted.slug,
    {},
    inserted as unknown as Record<string, unknown>,
    null,
    "create",
  );
  await writeAuditEntries(entries);

  bustProductCaches();

  return NextResponse.json({ product: inserted }, { status: 201 });
}
