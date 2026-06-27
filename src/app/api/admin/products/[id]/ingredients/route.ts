import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { hasValidPinGrant } from "@/lib/pin-grant";
import { PRODUCT_INGREDIENTS_TAG } from "@/lib/ingredients";

// Ingredients for a single product.
//   GET  → list all (ordered by sort_order asc).
//   POST → create one { name } appended at max(sort_order)+1.
//
// product_ingredients.product_id == products.id == slug, so we use
// params.id directly as the product_id.

const INGREDIENT_SELECT = "id, product_id, name, sort_order";

function bust(): void {
  revalidateTag(PRODUCT_INGREDIENTS_TAG);
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("product_ingredients")
    .select(INGREDIENT_SELECT)
    .eq("product_id", params.id)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[admin/ingredients GET]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ingredients: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasValidPinGrant(req)) {
    return NextResponse.json(
      { error: "PIN verification required.", code: "pin_required" },
      { status: 401 },
    );
  }

  // Confirm product exists.
  const { data: product, error: prodErr } = await supabaseAdmin
    .from("products")
    .select("id")
    .eq("id", params.id)
    .maybeSingle();
  if (prodErr) {
    return NextResponse.json({ error: prodErr.message }, { status: 500 });
  }
  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Append at the end: max(sort_order)+1 (0 when empty).
  const { data: last } = await supabaseAdmin
    .from("product_ingredients")
    .select("sort_order")
    .eq("product_id", params.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = last ? Number(last.sort_order) + 1 : 0;

  const { data: row, error: insertErr } = await supabaseAdmin
    .from("product_ingredients")
    .insert({ product_id: params.id, name, sort_order: nextSort })
    .select(INGREDIENT_SELECT)
    .single();

  if (insertErr || !row) {
    console.error("[admin/ingredients POST]", insertErr?.message);
    return NextResponse.json(
      { error: insertErr?.message ?? "Insert failed" },
      { status: 500 },
    );
  }

  bust();

  void recordAuditEvent({
    req,
    entity: "product",
    action: "update",
    targetId: params.id,
    targetLabel: name,
    context: `Added ingredient "${name}"`,
    meta: { kind: "ingredient", product_id: params.id, sort_order: nextSort },
  });

  return NextResponse.json({ ingredient: row });
}
