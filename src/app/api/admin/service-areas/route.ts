// Admin CRUD for service_areas. GET returns every row (active + inactive)
// so the admin UI can show paused pincodes too. POST upserts one pincode
// with one or many area_names.

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { SERVICE_AREAS_TAG, normalizePincode } from "@/lib/service-areas";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data, error } = await supabaseAdmin
    .from("service_areas")
    .select("pincode, area_name, is_active, added_at, added_by")
    .order("added_at", { ascending: false });
  if (error) {
    console.error("[admin/service-areas] list failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    pincode?: unknown;
    area_names?: unknown;
  };

  const pincode = normalizePincode(body.pincode);
  if (!pincode) {
    return NextResponse.json(
      { error: "Pincode must be 6 digits" },
      { status: 400 },
    );
  }

  const rawAreas = Array.isArray(body.area_names) ? body.area_names : [];
  const areaNames = Array.from(
    new Set(
      rawAreas
        .map((n) => String(n ?? "").trim())
        .filter((n) => n.length > 0 && n.length <= 80),
    ),
  );
  if (areaNames.length === 0) {
    return NextResponse.json(
      { error: "At least one area name is required" },
      { status: 400 },
    );
  }

  const rows = areaNames.map((area_name) => ({
    pincode,
    area_name,
    is_active: true,
    added_by: "admin",
  }));

  // upsert on the composite PK so re-activating a previously-deactivated
  // (pincode, area_name) pair just flips is_active back to true.
  const { error } = await supabaseAdmin
    .from("service_areas")
    .upsert(rows, { onConflict: "pincode,area_name" });
  if (error) {
    console.error("[admin/service-areas] upsert failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidateTag(SERVICE_AREAS_TAG);

  void recordAuditEvent({
    req,
    entity: "service_area",
    action: "create",
    targetId: pincode,
    targetLabel: `Pincode ${pincode}`,
    context: `Activated pincode ${pincode} (${areaNames.join(", ")})`,
    meta: { pincode, area_names: areaNames },
  });

  return NextResponse.json({ ok: true, pincode, area_names: areaNames });
}
