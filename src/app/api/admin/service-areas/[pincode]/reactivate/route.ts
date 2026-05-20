import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { geocodeArea } from "@/lib/geocode";
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

  // Back-fill geocodes for any rows that pre-date the geocoding feature.
  // Best-effort: failures here don't block reactivation.
  const { data: missing } = await supabaseAdmin
    .from("service_areas")
    .select("pincode, area_name")
    .eq("pincode", pincode)
    .is("latitude", null);
  if (missing && missing.length > 0) {
    const stamp = new Date().toISOString();
    for (const row of missing) {
      const geo = await geocodeArea(row.area_name as string, pincode);
      if (geo) {
        await supabaseAdmin
          .from("service_areas")
          .update({
            latitude: geo.latitude,
            longitude: geo.longitude,
            geocoded_at: stamp,
          })
          .eq("pincode", pincode)
          .eq("area_name", row.area_name);
      }
    }
  }

  revalidateTag(SERVICE_AREAS_TAG);

  void recordAuditEvent({
    req,
    entity: "service_area",
    action: "unarchive",
    targetId: pincode,
    targetLabel: `Pincode ${pincode}`,
    context: `Reactivated pincode ${pincode}`,
  });

  return NextResponse.json({ ok: true });
}
