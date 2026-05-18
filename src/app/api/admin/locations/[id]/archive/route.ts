import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";

// POST /api/admin/locations/[id]/archive — soft-delete by flipping
// is_archived=true. Archived rows disappear from public /find-us and
// /api/locations but stay in the admin list (with `?include_archived=1`)
// for restore.
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
  if (before.is_archived) {
    return NextResponse.json({ error: "Already archived" }, { status: 409 });
  }

  const archivedAt = new Date().toISOString();
  const { data: after, error: updErr } = await supabaseAdmin
    .from("pickup_locations")
    .update({ is_archived: true, archived_at: archivedAt })
    .eq("id", params.id)
    .select("id, name, is_archived, archived_at")
    .single();

  if (updErr || !after) {
    console.error("[admin/locations archive]", updErr?.message);
    return NextResponse.json(
      { error: updErr?.message ?? "Archive failed" },
      { status: 500 },
    );
  }

  revalidateTag("pickup-locations");

  void recordAuditEvent({
    req,
    entity: "other",
    action: "archive",
    targetId: after.id,
    targetLabel: after.name,
    context: `Archived pickup location "${after.name}"`,
    meta: { archived_at: after.archived_at },
  });

  return NextResponse.json({ location: after });
}
