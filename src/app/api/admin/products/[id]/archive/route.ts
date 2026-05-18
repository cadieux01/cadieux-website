import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { writeAuditEntries } from "@/lib/admin-product-audit";

// POST /api/admin/products/[id]/archive
//   Soft-deletes the product by flipping is_archived=true and stamping
//   archived_at=now(). The public shop filters is_archived rows out, so
//   the product disappears from the catalogue without losing history,
//   inventory, or referential integrity with past orders.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: before, error: beforeErr } = await supabaseAdmin
    .from("products")
    .select("id, slug, is_archived")
    .eq("id", params.id)
    .maybeSingle();
  if (beforeErr) {
    return NextResponse.json({ error: beforeErr.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (before.is_archived) {
    return NextResponse.json({ error: "Already archived" }, { status: 409 });
  }

  const archivedAt = new Date().toISOString();
  const { data: after, error: updErr } = await supabaseAdmin
    .from("products")
    .update({ is_archived: true, archived_at: archivedAt })
    .eq("id", params.id)
    .select("id, slug, is_archived, archived_at")
    .single();

  if (updErr || !after) {
    console.error("[admin/products archive]", updErr?.message);
    return NextResponse.json(
      { error: updErr?.message ?? "Archive failed" },
      { status: 500 },
    );
  }

  await writeAuditEntries([
    {
      product_id: after.id,
      product_slug: after.slug,
      field_changed: "is_archived",
      old_value: false,
      new_value: true,
      changed_by: null,
      context: "archive",
    },
  ]);

  revalidateTag("products");
  revalidateTag("subscription-plans");

  return NextResponse.json({ product: after });
}
