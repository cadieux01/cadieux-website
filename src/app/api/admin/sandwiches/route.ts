// Admin catalogue for sandwiches. Backend-only until a customer surface
// ships (the table has RLS on + grants revoked, so service_role is the only
// path — see 20260921120100_create_sandwiches_tables.sql).
//
// GET  — list every sandwich with its variants (all bread rows nested).
// POST — create a sandwich shell; variants are added via PATCH on [id].

import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";

const SLUG_RE = /^[a-z0-9][a-z0-9\-]*[a-z0-9]$/;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("sandwiches")
    .select(
      "id, slug, name, category, description, image_url, gallery_urls, is_available, sort_order, created_at, updated_at, sandwich_variants(id, bread_slug, price_inr, is_available, created_at, updated_at)",
    )
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.error("[admin/sandwiches GET]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { sandwiches: data ?? [] },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const nameRaw = typeof body.name === "string" ? body.name.trim() : "";
  if (!nameRaw) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const category = body.category;
  if (category !== "veg" && category !== "nonveg") {
    return NextResponse.json(
      { error: "category must be 'veg' or 'nonveg'" },
      { status: 400 },
    );
  }

  const slugSource =
    typeof body.slug === "string" && body.slug.trim().length > 0
      ? body.slug.trim()
      : nameRaw;
  const slug = slugify(slugSource);
  if (!SLUG_RE.test(slug) || slug.length < 2 || slug.length > 60) {
    return NextResponse.json(
      { error: "slug could not be derived (2-60 chars, [a-z0-9-])" },
      { status: 400 },
    );
  }

  // Reject duplicate slugs with a cleaner message than the unique index.
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("sandwiches")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (lookupErr) {
    console.error("[admin/sandwiches POST] lookup:", lookupErr.message);
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json(
      { error: `slug "${slug}" already exists` },
      { status: 409 },
    );
  }

  // Land new rows at the end unless caller pinned sort_order.
  let nextSort = 0;
  if (typeof body.sort_order === "number" && Number.isFinite(body.sort_order)) {
    nextSort = Math.trunc(body.sort_order);
  } else {
    const { data: maxRow } = await supabaseAdmin
      .from("sandwiches")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    nextSort = (maxRow?.sort_order ?? 0) + 10;
  }

  const insertRow = {
    slug,
    name: nameRaw,
    category,
    description:
      typeof body.description === "string" && body.description.trim().length > 0
        ? body.description.trim()
        : null,
    image_url:
      typeof body.image_url === "string" && body.image_url.trim().length > 0
        ? body.image_url.trim()
        : null,
    gallery_urls: Array.isArray(body.gallery_urls)
      ? body.gallery_urls
          .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
          .map((u) => u.trim())
      : [],
    is_available:
      typeof body.is_available === "boolean" ? body.is_available : true,
    sort_order: nextSort,
  };

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("sandwiches")
    .insert(insertRow)
    .select(
      "id, slug, name, category, description, image_url, gallery_urls, is_available, sort_order, created_at, updated_at",
    )
    .single();

  if (insertErr || !inserted) {
    console.error("[admin/sandwiches POST] insert:", insertErr?.message);
    return NextResponse.json(
      { error: insertErr?.message ?? "Insert failed" },
      { status: 500 },
    );
  }

  void recordAuditEvent({
    req,
    entity: "other",
    action: "create",
    targetId: inserted.id,
    targetLabel: `sandwich:${inserted.slug}`,
    context: `Created sandwich "${inserted.name}" (${inserted.category})`,
    meta: {
      slug: inserted.slug,
      category: inserted.category,
      sort_order: inserted.sort_order,
    },
  });

  return NextResponse.json(
    { sandwich: { ...inserted, sandwich_variants: [] } },
    { status: 201 },
  );
}
