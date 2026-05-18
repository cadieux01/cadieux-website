import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import {
  PRODUCT_REPORT_CATEGORIES,
  ProductReportCategory,
} from "@/lib/product-reports";

// Edit / hard-delete a single lab report.
//   PATCH  → mutate title, category, sort_order (no file replacement —
//            replace = delete + create, keeps storage cleanup simple).
//   DELETE → permanent delete + remove the storage object.
//
// Soft archive/unarchive live under /archive and /unarchive child routes.

const BUCKET = "product-reports";
const REPORT_SELECT =
  "id, product_id, title, category, file_url, file_name, file_mime, file_size_bytes, storage_path, sort_order, is_archived, uploaded_at, updated_at";

function bust(): void {
  revalidateTag("product-reports");
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; reportId: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const update: Record<string, unknown> = {};
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
  update.updated_at = new Date().toISOString();

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

  bust();
  return NextResponse.json({ report: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; reportId: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from("product_reports")
    .select("storage_path")
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

  bust();
  return NextResponse.json({ ok: true });
}
