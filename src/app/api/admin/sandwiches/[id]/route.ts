// Per-sandwich admin edit + delete. Also handles variants (per-bread
// prices) inline — a full PATCH replaces the variants array so the client
// can send the whole "prices grid" in one round-trip.
//
// PATCH body:
//   {
//     name?, slug?, category?, description?, image_url?, gallery_urls?,
//     is_available?, sort_order?,
//     variants?: [{ bread_slug, price_inr, is_available? }]
//       // FULL REPLACEMENT — rows absent from the array are DELETED.
//       // A "not offered on that bread" cell is a missing row, not a
//       // present-with-NULL row (matches the seed migration's contract).
//   }

import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";

const SLUG_RE = /^[a-z0-9][a-z0-9\-]*[a-z0-9]$/;

type VariantInput = {
  bread_slug: string;
  price_inr: number;
  is_available?: boolean;
};

function parseVariants(raw: unknown): VariantInput[] | null {
  if (!Array.isArray(raw)) return null;
  const out: VariantInput[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") return null;
    const rec = v as Record<string, unknown>;
    const bread = typeof rec.bread_slug === "string" ? rec.bread_slug.trim() : "";
    const price = Number(rec.price_inr);
    if (bread.length < 1 || bread.length > 60) return null;
    if (!Number.isFinite(price) || price <= 0 || price >= 100000) return null;
    const isAvail =
      typeof rec.is_available === "boolean" ? rec.is_available : true;
    out.push({
      bread_slug: bread,
      price_inr: Math.trunc(price),
      is_available: isAvail,
    });
  }
  return out;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = params.id;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Load current row so we can audit before/after + reject 404s explicitly.
  const { data: before, error: beforeErr } = await supabaseAdmin
    .from("sandwiches")
    .select(
      "id, slug, name, category, description, image_url, gallery_urls, is_available, sort_order",
    )
    .eq("id", id)
    .maybeSingle();
  if (beforeErr) {
    return NextResponse.json({ error: beforeErr.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const update: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const n = body.name.trim();
    if (n.length < 1 || n.length > 120) {
      return NextResponse.json({ error: "name length invalid" }, { status: 400 });
    }
    update.name = n;
  }

  if (typeof body.slug === "string") {
    const s = body.slug.trim().toLowerCase();
    if (!SLUG_RE.test(s) || s.length < 2 || s.length > 60) {
      return NextResponse.json({ error: "slug invalid" }, { status: 400 });
    }
    update.slug = s;
  }

  if (body.category !== undefined) {
    if (body.category !== "veg" && body.category !== "nonveg") {
      return NextResponse.json(
        { error: "category must be 'veg' or 'nonveg'" },
        { status: 400 },
      );
    }
    update.category = body.category;
  }

  if (body.description !== undefined) {
    update.description =
      typeof body.description === "string" && body.description.trim().length > 0
        ? body.description.trim()
        : null;
  }

  if (body.image_url !== undefined) {
    update.image_url =
      typeof body.image_url === "string" && body.image_url.trim().length > 0
        ? body.image_url.trim()
        : null;
  }

  if (body.gallery_urls !== undefined) {
    if (!Array.isArray(body.gallery_urls)) {
      return NextResponse.json(
        { error: "gallery_urls must be an array" },
        { status: 400 },
      );
    }
    update.gallery_urls = body.gallery_urls
      .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
      .map((u) => u.trim());
  }

  if (typeof body.is_available === "boolean") {
    update.is_available = body.is_available;
  }

  if (typeof body.sort_order === "number" && Number.isFinite(body.sort_order)) {
    update.sort_order = Math.trunc(body.sort_order);
  }

  // Sandwich row update (empty is fine — variants may still change).
  if (Object.keys(update).length > 0) {
    const { error: updErr } = await supabaseAdmin
      .from("sandwiches")
      .update(update)
      .eq("id", id);
    if (updErr) {
      console.error("[admin/sandwiches PATCH] update:", updErr.message);
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
  }

  // Variants: FULL REPLACEMENT semantics. The client sends the exact set of
  // (bread_slug, price_inr) it wants; missing bread_slugs are removed. We
  // upsert first (to preserve existing ids + timestamps for unchanged rows)
  // and then delete rows whose bread_slug is NOT in the new set.
  if (body.variants !== undefined) {
    const parsed = parseVariants(body.variants);
    if (!parsed) {
      return NextResponse.json(
        { error: "variants: each { bread_slug, price_inr>0 } required" },
        { status: 400 },
      );
    }
    // Dedup by bread_slug (last write wins on the client side).
    const seen = new Map<string, VariantInput>();
    for (const v of parsed) seen.set(v.bread_slug, v);
    const list: VariantInput[] = [];
    seen.forEach((v) => list.push(v));

    if (list.length > 0) {
      const rows = list.map((v) => ({
        sandwich_id: id,
        bread_slug: v.bread_slug,
        price_inr: v.price_inr,
        is_available: v.is_available ?? true,
      }));
      const { error: upsertErr } = await supabaseAdmin
        .from("sandwich_variants")
        .upsert(rows, { onConflict: "sandwich_id,bread_slug" });
      if (upsertErr) {
        console.error("[admin/sandwiches PATCH] variants upsert:", upsertErr.message);
        return NextResponse.json({ error: upsertErr.message }, { status: 500 });
      }
    }

    // Delete variants the client did NOT resend.
    const keepSlugs = list.map((v) => v.bread_slug);
    let del = supabaseAdmin
      .from("sandwich_variants")
      .delete()
      .eq("sandwich_id", id);
    if (keepSlugs.length > 0) {
      del = del.not(
        "bread_slug",
        "in",
        `(${keepSlugs.map((s) => `"${s.replace(/"/g, '""')}"`).join(",")})`,
      );
    }
    const { error: delErr } = await del;
    if (delErr) {
      console.error("[admin/sandwiches PATCH] variants delete:", delErr.message);
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
  }

  const { data: after, error: afterErr } = await supabaseAdmin
    .from("sandwiches")
    .select(
      "id, slug, name, category, description, image_url, gallery_urls, is_available, sort_order, created_at, updated_at, sandwich_variants(id, bread_slug, price_inr, is_available, created_at, updated_at)",
    )
    .eq("id", id)
    .single();
  if (afterErr || !after) {
    return NextResponse.json(
      { error: afterErr?.message ?? "Refresh failed" },
      { status: 500 },
    );
  }

  void recordAuditEvent({
    req,
    entity: "other",
    action: "update",
    targetId: after.id,
    targetLabel: `sandwich:${after.slug}`,
    context: `Updated sandwich "${after.name}"`,
    meta: {
      before,
      changed: Object.keys(update),
      variants_touched: body.variants !== undefined,
    },
  });

  return NextResponse.json({ sandwich: after });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = params.id;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // Load first so we can audit + 404 cleanly. ON DELETE CASCADE takes care
  // of sandwich_variants — no explicit sweep needed.
  const { data: existing, error: readErr } = await supabaseAdmin
    .from("sandwiches")
    .select("id, slug, name, category")
    .eq("id", id)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error: delErr } = await supabaseAdmin
    .from("sandwiches")
    .delete()
    .eq("id", id);
  if (delErr) {
    console.error("[admin/sandwiches DELETE]", delErr.message);
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  void recordAuditEvent({
    req,
    entity: "other",
    action: "delete",
    targetId: existing.id,
    targetLabel: `sandwich:${existing.slug}`,
    context: `Deleted sandwich "${existing.name}"`,
    meta: { slug: existing.slug, category: existing.category },
  });

  return NextResponse.json({ ok: true });
}
