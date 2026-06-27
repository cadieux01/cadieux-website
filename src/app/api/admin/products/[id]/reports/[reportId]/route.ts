import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { hasValidPinGrant } from "@/lib/pin-grant";
import {
  PRODUCT_REPORT_CATEGORIES,
  ProductReportCategory,
  productReportsTag,
} from "@/lib/product-reports";

// Edit / hard-delete a single lab report.
//   PATCH  → mutate title, category, sort_order (no file replacement —
//            replace = delete + create, keeps storage cleanup simple).
//   DELETE → permanent delete + remove the storage object.
//
// Soft archive/unarchive live under /archive and /unarchive child routes.

const BUCKET = "product-reports";
const REPORT_SELECT =
  "id, product_id, title, report_number, report_name, summary, category, file_url, file_name, mime_type, file_size_bytes, storage_path, sort_order, is_archived, uploaded_at, archived_at";

function bust(productId: string): void {
  revalidateTag("product-reports");
  revalidateTag(productReportsTag(productId));
}

export async function PATCH(
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

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  if ("report_name" in body) {
    if (typeof body.report_name !== "string" || !body.report_name.trim()) {
      return NextResponse.json(
        { error: "report_name must be a non-empty string" },
        { status: 400 },
      );
    }
    // report_name is the heading; keep title in sync for back-compat.
    update.report_name = body.report_name.trim();
    update.title = body.report_name.trim();
  }
  if ("report_number" in body) {
    if (body.report_number !== null && typeof body.report_number !== "string") {
      return NextResponse.json(
        { error: "report_number must be a string or null" },
        { status: 400 },
      );
    }
    const v =
      typeof body.report_number === "string" ? body.report_number.trim() : "";
    update.report_number = v || null;
  }
  if ("summary" in body) {
    if (body.summary !== null && typeof body.summary !== "string") {
      return NextResponse.json(
        { error: "summary must be a string or null" },
        { status: 400 },
      );
    }
    const v = typeof body.summary === "string" ? body.summary.trim() : "";
    update.summary = v || null;
  }
  if ("title" in body) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json(
        { error: "title must be a non-empty string" },
        { status: 400 },
      );
    }
    update.title = body.title.trim();
  }
  if ("category" in body) {
    const cat = body.category as ProductReportCategory;
    if (!PRODUCT_REPORT_CATEGORIES.includes(cat)) {
      return NextResponse.json(
        { error: `Invalid category "${String(cat)}"` },
        { status: 400 },
      );
    }
    update.category = cat;
  }
  if ("sort_order" in body) {
    const n = Number(body.sort_order);
    if (!Number.isFinite(n)) {
      return NextResponse.json(
        { error: "sort_order must be a number" },
        { status: 400 },
      );
    }
    update.sort_order = Math.trunc(n);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("product_reports")
    .update(update)
    .eq("id", params.reportId)
    .eq("product_id", params.id)
    .select(REPORT_SELECT)
    .single();

  if (error || !data) {
    console.error("[admin/reports PATCH]", error?.message);
    return NextResponse.json(
      { error: error?.message ?? "Not found" },
      { status: error ? 500 : 404 },
    );
  }

  bust(params.id);

  void recordAuditEvent({
    req,
    entity: "product_report",
    action: "update",
    targetId: data.id,
    targetLabel: data.title,
    context: `Edited report "${data.title}"`,
    meta: {
      product_id: params.id,
      fields: Object.keys(update),
    },
  });

  return NextResponse.json({ report: data });
}

export async function DELETE(
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

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from("product_reports")
    .select("storage_path, title, category")
    .eq("id", params.reportId)
    .eq("product_id", params.id)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error: delErr } = await supabaseAdmin
    .from("product_reports")
    .delete()
    .eq("id", params.reportId)
    .eq("product_id", params.id);
  if (delErr) {
    console.error("[admin/reports DELETE row]", delErr.message);
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // Best-effort storage cleanup — orphan is preferable to a 500 on the
  // already-deleted row, so we log instead of unwinding.
  const { error: rmErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .remove([row.storage_path]);
  if (rmErr) {
    console.warn("[admin/reports DELETE storage]", rmErr.message);
  }

  bust(params.id);

  void recordAuditEvent({
    req,
    entity: "product_report",
    action: "delete",
    targetId: params.reportId,
    targetLabel: row.title,
    context: `Deleted report "${row.title}"`,
    meta: {
      product_id: params.id,
      category: row.category,
      storage_path: row.storage_path,
    },
  });

  return NextResponse.json({ ok: true });
}
