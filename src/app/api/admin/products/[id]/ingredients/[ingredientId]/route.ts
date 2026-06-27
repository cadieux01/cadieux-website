import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { hasValidPinGrant } from "@/lib/pin-grant";
import { PRODUCT_INGREDIENTS_TAG } from "@/lib/ingredients";
import { CONTENT_CACHE_TAG } from "@/lib/content";

// Edit / delete a single ingredient.
//   PATCH  → update name, role, is_visible, and/or sort_order.
//   DELETE → remove the row, then re-pack remaining sort_order so there
//            are no gaps (0..n-1 in their current order).

const INGREDIENT_SELECT =
  "id, product_id, name, sort_order, role, is_visible, locale";

function bust(): void {
  revalidateTag(PRODUCT_INGREDIENTS_TAG);
  revalidateTag(CONTENT_CACHE_TAG);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; ingredientId: string } },
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

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const update: Record<string, unknown> = {};

  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json(
        { error: "name must be a non-empty string" },
        { status: 400 },
      );
    }
    update.name = body.name.trim();
  }
  if ("role" in body) {
    if (body.role === null) {
      update.role = null;
    } else if (typeof body.role === "string") {
      const r = body.role.trim();
      update.role = r.length === 0 ? null : r;
    } else {
      return NextResponse.json(
        { error: "role must be a string or null" },
        { status: 400 },
      );
    }
  }
  if ("is_visible" in body) {
    if (typeof body.is_visible !== "boolean") {
      return NextResponse.json(
        { error: "is_visible must be a boolean" },
        { status: 400 },
      );
    }
    update.is_visible = body.is_visible;
  }
  if ("sort_order" in body) {
    const n = Number(body.sort_order);
    if (!Number.isFinite(n)) {
      return NextResponse.json(
        { error: "sort_order must be a number" },
        { status: 400 },
      );
    }
    update.sort_order = Math.trunc(n);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("product_ingredients")
    .update(update)
    .eq("id", params.ingredientId)
    .eq("product_id", params.id)
    .select(INGREDIENT_SELECT)
    .single();

  if (error || !data) {
    console.error("[admin/ingredients PATCH]", error?.message);
    return NextResponse.json(
      { error: error?.message ?? "Not found" },
      { status: error ? 500 : 404 },
    );
  }

  bust();

  void recordAuditEvent({
    req,
    entity: "product",
    action: "update",
    targetId: params.id,
    targetLabel: data.name,
    context: `Edited ingredient "${data.name}"`,
    meta: { kind: "ingredient", product_id: params.id, fields: Object.keys(update) },
  });

  return NextResponse.json({ ingredient: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; ingredientId: string } },
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

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from("product_ingredients")
    .select("id, name")
    .eq("id", params.ingredientId)
    .eq("product_id", params.id)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error: delErr } = await supabaseAdmin
    .from("product_ingredients")
    .delete()
    .eq("id", params.ingredientId)
    .eq("product_id", params.id);
  if (delErr) {
    console.error("[admin/ingredients DELETE]", delErr.message);
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // Re-pack sort_order so the remaining rows are 0..n-1 with no gaps.
  const { data: rest } = await supabaseAdmin
    .from("product_ingredients")
    .select("id")
    .eq("product_id", params.id)
    .order("sort_order", { ascending: true });
  if (rest && rest.length > 0) {
    await Promise.all(
      rest.map((r, i) =>
        supabaseAdmin
          .from("product_ingredients")
          .update({ sort_order: i })
          .eq("id", r.id),
      ),
    );
  }

  bust();

  void recordAuditEvent({
    req,
    entity: "product",
    action: "update",
    targetId: params.id,
    targetLabel: row.name,
    context: `Deleted ingredient "${row.name}"`,
    meta: { kind: "ingredient", product_id: params.id },
  });

  return NextResponse.json({ ok: true });
}
