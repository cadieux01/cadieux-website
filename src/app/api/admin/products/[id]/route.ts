import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import {
  AUDITED_FIELDS,
  AuditedField,
  buildAuditEntries,
  slugify,
  writeAuditEntries,
} from "@/lib/admin-product-audit";
import { recordAuditEvent } from "@/lib/audit-log";
import { logLogisticsAudit } from "@/lib/logistics-audit";
import { hasValidPinGrant } from "@/lib/pin-grant";
import { parseBodyFromObject, ProductUpdateSchema } from "@/lib/validation";
import { CONTENT_CACHE_TAG } from "@/lib/content";

function bustProductCaches(): void {
  revalidateTag("products");
  revalidateTag("subscription-plans");
  // Shop list + PDP now read name/description/tagline through getPageContent,
  // which falls back to the products row — bust it too so admin edits show.
  revalidateTag(CONTENT_CACHE_TAG);
}

const PRODUCT_SELECT =
  "id, slug, name, price_inr, subscription_per_loaf_inr, weight, description, tagline, highlights, image_url, is_active, in_stock, is_archived, archived_at, sort_order, updated_at";

// GET /api/admin/products/[id]
//   Returns { product, history } where history is the last 50 audit
//   rows in reverse-chronological order.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const productP = supabaseAdmin
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("id", params.id)
    .maybeSingle();

  const historyP = supabaseAdmin
    .from("product_changes")
    .select("*")
    .eq("product_id", params.id)
    .order("changed_at", { ascending: false })
    .limit(50);

  const [productRes, historyRes] = await Promise.all([productP, historyP]);

  if (productRes.error) {
    console.error("[admin/products GET id]", productRes.error.message);
    return NextResponse.json(
      { error: productRes.error.message },
      { status: 500 },
    );
  }
  if (!productRes.data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // The product_changes table is optional in dev — if it doesn't exist
  // yet we return an empty history rather than 500.
  const history = historyRes.error ? [] : historyRes.data ?? [];

  return NextResponse.json({ product: productRes.data, history });
}

// PATCH /api/admin/products/[id]
//   Accepts any subset of the audited fields plus implicit derivations:
//     - if `price_inr` is set and `subscription_per_loaf_inr` is not,
//       the subscription price is auto-synced to the new price_inr.
//     - if `slug` is set, it's re-slugified to enforce safe shape and
//       checked for collisions.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // PIN gate: editing an existing product requires a valid PIN grant
  // (header `x-pin-grant` or the `pin_verified` cookie), minted by
  // /api/admin/pin { action: "verify" } against website_admin_pin.
  // Enforced server-side so a direct API call cannot bypass the prompt.
  if (!hasValidPinGrant(req)) {
    return NextResponse.json(
      { error: "PIN verification required.", code: "pin_required" },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => ({}));

  // Shape-level guard: rejects unknown keys, bad types, out-of-range
  // numbers, oversize strings, etc. before any DB work. The per-field
  // coercion below (slug collision, auto-sync subscription price) still
  // runs — this layer just makes sure we never reach it with garbage.
  const shape = parseBodyFromObject(body, ProductUpdateSchema);
  if (!shape.ok) return shape.response;

  const { data: before, error: beforeErr } = await supabaseAdmin
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("id", params.id)
    .maybeSingle();
  if (beforeErr) {
    return NextResponse.json({ error: beforeErr.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Whitelist the incoming fields so a stray "id" / "archived_at" /
  // "updated_at" from a copy-paste body can't slip past.
  const update: Record<string, unknown> = {};
  for (const f of AUDITED_FIELDS as readonly AuditedField[]) {
    if (f in body) update[f] = body[f];
  }

  if ("slug" in update) {
    if (typeof update.slug !== "string") {
      return NextResponse.json({ error: "slug must be a string" }, { status: 400 });
    }
    const cleaned = slugify(update.slug);
    if (!cleaned) {
      return NextResponse.json({ error: "slug is empty after sanitising" }, { status: 400 });
    }
    if (cleaned !== before.slug) {
      const { data: dupe } = await supabaseAdmin
        .from("products")
        .select("id")
        .eq("slug", cleaned)
        .neq("id", params.id)
        .maybeSingle();
      if (dupe) {
        return NextResponse.json(
          { error: `slug "${cleaned}" already exists` },
          { status: 409 },
        );
      }
    }
    update.slug = cleaned;
  }

  if ("price_inr" in update) {
    const n = Number(update.price_inr);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: "price_inr must be a non-negative number" }, { status: 400 });
    }
    update.price_inr = n;
    // Auto-sync subscription pricing when only the one-time price moved.
    if (!("subscription_per_loaf_inr" in update)) {
      update.subscription_per_loaf_inr = n;
    }
  }
  if ("subscription_per_loaf_inr" in update) {
    if (update.subscription_per_loaf_inr === null) {
      // explicit null is allowed — means "no subscription price set"
    } else {
      const n = Number(update.subscription_per_loaf_inr);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json(
          { error: "subscription_per_loaf_inr must be a non-negative number" },
          { status: 400 },
        );
      }
      update.subscription_per_loaf_inr = n;
    }
  }
  if ("highlights" in update && !Array.isArray(update.highlights)) {
    return NextResponse.json({ error: "highlights must be an array" }, { status: 400 });
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data: after, error: updErr } = await supabaseAdmin
    .from("products")
    .update(update)
    .eq("id", params.id)
    .select(PRODUCT_SELECT)
    .single();

  if (updErr || !after) {
    console.error("[admin/products PATCH]", updErr?.message);
    return NextResponse.json(
      { error: updErr?.message ?? "Update failed" },
      { status: 500 },
    );
  }

  const entries = buildAuditEntries(
    after.id,
    after.slug,
    before as unknown as Record<string, unknown>,
    after as unknown as Record<string, unknown>,
    null,
    "update",
  );
  await writeAuditEntries(entries);

  bustProductCaches();

  const priceChanged =
    "price_inr" in update && before.price_inr !== after.price_inr;
  void recordAuditEvent({
    req,
    entity: "product",
    action: priceChanged ? "price_change" : "update",
    targetId: after.id,
    targetLabel: after.name,
    context: priceChanged
      ? `Changed price for "${after.name}" from ₹${before.price_inr} to ₹${after.price_inr}`
      : `Updated product "${after.name}"`,
    meta: {
      slug: after.slug,
      fields: Object.keys(update),
      ...(priceChanged
        ? {
            price_before: before.price_inr,
            price_after: after.price_inr,
          }
        : {}),
    },
  });

  // Unified audit trail (logistics.audit_logs) — PIN verified.
  void logLogisticsAudit({
    actionType: "UPDATE",
    entityType: "product",
    entityId: after.id,
    category: "product",
    description: priceChanged
      ? `Product price changed by Super Admin — PIN verified ("${after.name}": ₹${before.price_inr} → ₹${after.price_inr})`
      : `Product updated by Super Admin — PIN verified ("${after.name}")`,
    oldValues: before,
    newValues: after,
    metadata: { slug: after.slug, fields: Object.keys(update), priceChanged },
  });

  return NextResponse.json({ product: after });
}
