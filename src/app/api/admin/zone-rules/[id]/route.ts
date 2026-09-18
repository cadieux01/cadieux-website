// DELETE /api/admin/zone-rules/[id]
//
// Deletes a single learned rule row. The board's confirm dialog has already
// shown the delete preview (how many rows revert to the built-in map); this
// endpoint is the write.

import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = params.id;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid rule id." }, { status: 400 });
  }
  const { error } = await supabaseAdmin
    .from("delivery_zone_rules")
    .delete()
    .eq("id", id);
  if (error) {
    console.error("[admin/zone-rules DELETE]", error.message);
    return NextResponse.json({ error: "Failed to delete rule." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
