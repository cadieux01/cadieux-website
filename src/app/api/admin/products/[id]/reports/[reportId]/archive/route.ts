import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { hasValidPinGrant } from "@/lib/pin-grant";
import { productReportsTag } from "@/lib/product-reports";

// Soft-archive a lab report. Public PDP only renders is_archived=false
// rows, so this hides without losing the file.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; reportId: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasValidPinGrant(req)) {
    return NextResponse.json(
      { error: "PIN verification required.", code: "pin_required" },
      { status: 401 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("product_reports")
    .update({ is_archived: true, archived_at: new Date().toISOString() })
    .eq("id", params.reportId)
    .eq("product_id", params.id)
    .select("id, title")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Not found" },
      { status: error ? 500 : 404 },
    );
  }

  revalidateTag("product-reports");
  revalidateTag(productReportsTag(params.id));

  void recordAuditEvent({
    req,
    entity: "product_report",
    action: "archive",
    targetId: data.id,
    targetLabel: data.title,
    context: `Archived report "${data.title}"`,
    meta: { product_id: params.id },
  });

  return NextResponse.json({ ok: true });
}
