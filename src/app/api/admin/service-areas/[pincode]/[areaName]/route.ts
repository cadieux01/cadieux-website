// Removes a single (pincode, area_name) row from service_areas. Used by
// the admin UI when an area label was added by mistake. To take an
// entire pincode offline use the /deactivate sibling route instead.

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { SERVICE_AREAS_TAG, normalizePincode } from "@/lib/service-areas";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { pincode: string; areaName: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pincode = normalizePincode(params.pincode);
  const areaName = decodeURIComponent(params.areaName).trim();
  if (!pincode || !areaName) {
    return NextResponse.json(
      { error: "Invalid pincode or area" },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from("service_areas")
    .delete()
    .eq("pincode", pincode)
    .eq("area_name", areaName);
  if (error) {
    console.error("[admin/service-areas] delete failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidateTag(SERVICE_AREAS_TAG);

  void recordAuditEvent({
    req,
    entity: "other",
    action: "delete",
    targetId: pincode,
    targetLabel: `Pincode ${pincode}`,
    context: `Removed area "${areaName}" from pincode ${pincode}`,
  });

  return NextResponse.json({ ok: true });
}
