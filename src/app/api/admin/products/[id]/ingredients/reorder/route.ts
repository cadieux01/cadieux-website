import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { hasValidPinGrant } from "@/lib/pin-grant";
import { PRODUCT_INGREDIENTS_TAG } from "@/lib/ingredients";

// POST /api/admin/products/[id]/ingredients/reorder
//   body { orderedIds: string[] } — rewrites sort_order = index for each id.
//   Only ids belonging to this product are touched.

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

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const orderedIds = body.orderedIds;
  if (
    !Array.isArray(orderedIds) ||
    orderedIds.some((x) => typeof x !== "string")
  ) {
    return NextResponse.json(
      { error: "orderedIds must be an array of strings" },
      { status: 400 },
    );
  }

  // Guard against ids from a different product: only reorder rows that
  // actually belong to params.id.
  const { data: owned, error: ownErr } = await supabaseAdmin
    .from("product_ingredients")
    .select("id")
    .eq("product_id", params.id);
  if (ownErr) {
    return NextResponse.json({ error: ownErr.message }, { status: 500 });
  }
  const ownedIds = new Set((owned ?? []).map((r) => r.id as string));

  const updates = (orderedIds as string[]).filter((id) => ownedIds.has(id));
  await Promise.all(
    updates.map((id, i) =>
      supabaseAdmin
        .from("product_ingredients")
        .update({ sort_order: i })
        .eq("id", id)
        .eq("product_id", params.id),
    ),
  );

  revalidateTag(PRODUCT_INGREDIENTS_TAG);

  void recordAuditEvent({
    req,
    entity: "product",
    action: "update",
    targetId: params.id,
    targetLabel: "ingredient order",
    context: `Reordered ingredients`,
    meta: { kind: "ingredient", product_id: params.id, count: updates.length },
  });

  return NextResponse.json({ ok: true });
}
