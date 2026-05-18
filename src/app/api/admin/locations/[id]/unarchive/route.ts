import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";

// POST /api/admin/locations/[id]/unarchive — restore an archived row.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: before } = await supabaseAdmin
    .from("pickup_locations")
    .select("id, name, is_archived")
    .eq("id", params.id)
    .maybeSingle();
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!before.is_archived) {
    return NextResponse.json({ error: "Not archived" }, { status: 409 });
  }

  const { data: after, error: updErr } = await supabaseAdmin
    .from("pickup_locations")
    .update({ is_archived: false, archived_at: null })
    .eq("id", params.id)
    .select("id, name, is_archived, archived_at")
    .single();

  if (updErr || !after) {
    console.error("[admin/locations unarchive]", updErr?.message);
    return NextResponse.json(
      { error: updErr?.message ?? "Unarchive failed" },
      { status: 500 },
    );
  }

  revalidateTag("pickup-locations");

  void recordAuditEvent({
    req,
    entity: "other",
    action: "unarchive",
    targetId: after.id,
    targetLabel: after.name,
    context: `Restored pickup location "${after.name}"`,
    meta: null,
  });

  return NextResponse.json({ location: after });
}
