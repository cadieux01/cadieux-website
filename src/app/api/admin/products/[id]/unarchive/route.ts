import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { writeAuditEntries } from "@/lib/admin-product-audit";

// POST /api/admin/products/[id]/unarchive
//   Reverses an archive: is_archived=false, archived_at=null. The product
//   re-appears in the public catalogue immediately (subject to is_active
//   and the 60-second products cache).
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
  if (!before.is_archived) {
    return NextResponse.json({ error: "Not archived" }, { status: 409 });
  }

  const { data: after, error: updErr } = await supabaseAdmin
    .from("products")
    .update({ is_archived: false, archived_at: null })
    .eq("id", params.id)
    .select("id, slug, is_archived, archived_at")
    .single();

  if (updErr || !after) {
    console.error("[admin/products unarchive]", updErr?.message);
    return NextResponse.json(
      { error: updErr?.message ?? "Unarchive failed" },
      { status: 500 },
    );
  }

  await writeAuditEntries([
    {
      product_id: after.id,
      product_slug: after.slug,
      field_changed: "is_archived",
      old_value: true,
      new_value: false,
      changed_by: null,
      context: "unarchive",
    },
  ]);

  revalidateTag("products");
  revalidateTag("subscription-plans");

  return NextResponse.json({ product: after });
}
