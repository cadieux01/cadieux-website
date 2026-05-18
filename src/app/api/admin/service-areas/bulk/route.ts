// Bulk activate/deactivate of service areas by pincode. Accepts an
// array of pincodes and flips is_active on every row that matches. The
// per-pincode endpoints fire one Supabase update each; this one batches
// them by chaining a single update with `.in("pincode", ...)` so a
// 50-pincode bulk action stays a single round-trip.

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { SERVICE_AREAS_TAG, normalizePincode } from "@/lib/service-areas";

type BulkBody = {
  action?: unknown;
  pincodes?: unknown;
};

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as BulkBody;
  const action = body.action;
  if (action !== "activate" && action !== "deactivate") {
    return NextResponse.json(
      { error: "action must be 'activate' or 'deactivate'" },
      { status: 400 },
    );
  }

  const rawPincodes = Array.isArray(body.pincodes) ? body.pincodes : [];
  const pincodes = Array.from(
    new Set(
      rawPincodes
        .map((p) => normalizePincode(p))
        .filter((p): p is string => p !== null),
    ),
  );
  if (pincodes.length === 0) {
    return NextResponse.json(
      { error: "At least one valid pincode is required" },
      { status: 400 },
    );
  }
  if (pincodes.length > 200) {
    return NextResponse.json(
      { error: "Cannot process more than 200 pincodes at once" },
      { status: 400 },
    );
  }

  const isActive = action === "activate";
  const { data, error } = await supabaseAdmin
    .from("service_areas")
    .update({ is_active: isActive })
    .in("pincode", pincodes)
    .select("pincode");
  if (error) {
    console.error("[admin/service-areas/bulk] update failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Distinct pincodes actually touched (the in() filter may not match
  // every requested pincode if some don't exist in service_areas).
  const updatedPincodes = Array.from(
    new Set((data ?? []).map((r) => r.pincode as string)),
  );
  const failedPincodes = pincodes.filter((p) => !updatedPincodes.includes(p));

  revalidateTag(SERVICE_AREAS_TAG);

  void recordAuditEvent({
    req,
    entity: "service_area",
    action: action === "activate" ? "update" : "archive",
    targetId: null,
    targetLabel: `${updatedPincodes.length} pincode${
      updatedPincodes.length === 1 ? "" : "s"
    }`,
    context: `Bulk ${action}: ${updatedPincodes.join(", ") || "(none)"}`,
    meta: {
      action,
      requested: pincodes,
      succeeded: updatedPincodes,
      failed: failedPincodes,
    },
  });

  return NextResponse.json({
    ok: true,
    succeeded: updatedPincodes,
    failed: failedPincodes,
  });
}
