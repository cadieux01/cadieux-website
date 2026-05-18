import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { SERVICE_AREAS_TAG, normalizePincode } from "@/lib/service-areas";

export async function POST(
  req: NextRequest,
  { params }: { params: { pincode: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pincode = normalizePincode(params.pincode);
  if (!pincode) {
    return NextResponse.json({ error: "Invalid pincode" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("service_areas")
    .update({ is_active: true })
    .eq("pincode", pincode);
  if (error) {
    console.error("[admin/service-areas] reactivate failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidateTag(SERVICE_AREAS_TAG);

  void recordAuditEvent({
    req,
    entity: "other",
    action: "unarchive",
    targetId: pincode,
    targetLabel: `Pincode ${pincode}`,
    context: `Reactivated pincode ${pincode}`,
  });

  return NextResponse.json({ ok: true });
}
