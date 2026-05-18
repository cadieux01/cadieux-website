import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import {
  PRODUCT_REPORT_CATEGORIES,
  ProductReportCategory,
  productReportsTag,
} from "@/lib/product-reports";

// Lab Reports for a single product.
//   GET  → list all (incl. archived when ?include_archived=1).
//   POST → multipart upload: file + title + category + optional sort_order.
//
// Storage bucket: product-reports (public). File path is namespaced
// under the product id so a cascading product delete makes orphan
// files easy to spot: <product_id>/<timestamp>-<rand>.<ext>.

const BUCKET = "product-reports";
const MAX_BYTES = 10 * 1024 * 1024;

const REPORT_SELECT =
  "id, product_id, title, category, file_url, file_name, mime_type, file_size_bytes, storage_path, sort_order, is_archived, uploaded_at, archived_at";

function bust(productId: string): void {
  revalidateTag("product-reports");
  revalidateTag(productReportsTag(productId));
}

// Best-effort extension from the upload file name. Used to keep the
// stored object readable to humans — the public URL ends in .pdf /
// .png / etc. so browser viewers Just Work.
function extFromName(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "bin";
  const raw = name.slice(dot + 1).toLowerCase();
  return raw.replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const includeArchived =
    req.nextUrl.searchParams.get("include_archived") === "true" ||
    req.nextUrl.searchParams.get("include_archived") === "1";

  let q = supabaseAdmin
    .from("product_reports")
    .select(REPORT_SELECT)
    .eq("product_id", params.id);
  if (!includeArchived) {
    q = q.eq("is_archived", false);
  }
  const { data, error } = await q
    .order("sort_order", { ascending: true })
    .order("uploaded_at", { ascending: false });

  if (error) {
    console.error("[admin/reports GET]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ reports: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Confirm product exists before consuming the upload body.
  const { data: product, error: prodErr } = await supabaseAdmin
    .from("products")
    .select("id")
    .eq("id", params.id)
    .maybeSingle();
  if (prodErr) {
    return NextResponse.json({ error: prodErr.message }, { status: 500 });
  }
  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  const title = String(form.get("title") ?? "").trim();
  const category = String(form.get("category") ?? "other") as ProductReportCategory;
  const sortRaw = form.get("sort_order");
  const sortOrder = Number.isFinite(Number(sortRaw)) ? Number(sortRaw) : 0;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (!PRODUCT_REPORT_CATEGORIES.includes(category)) {
    return NextResponse.json(
      { error: `Invalid category "${category}"` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${file.size} bytes). Max ${MAX_BYTES}.` },
      { status: 400 },
    );
  }

  // No MIME allowlist — admin is trusted, and the spec wants any file
  // type accepted up to the 10 MB cap. Extension is derived from the
  // upload's filename so the stored path stays human-readable.
  const ext = extFromName(file.name);
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `${params.id}/${stamp}-${rand}.${ext}`;
  const contentType = file.type || "application/octet-stream";

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType,
      cacheControl: "31536000",
      upsert: false,
    });
  if (uploadErr) {
    console.error("[admin/reports POST upload]", uploadErr.message);
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) {
    // Roll back the upload so we don't leave an orphan.
    await supabaseAdmin.storage.from(BUCKET).remove([path]);
    return NextResponse.json(
      { error: "Uploaded but could not resolve public URL" },
      { status: 500 },
    );
  }

  const { data: row, error: insertErr } = await supabaseAdmin
    .from("product_reports")
    .insert({
      product_id: params.id,
      title,
      category,
      file_url: pub.publicUrl,
      file_name: file.name || `report.${ext}`,
      mime_type: file.type || null,
      file_size_bytes: file.size,
      storage_path: path,
      sort_order: sortOrder,
    })
    .select(REPORT_SELECT)
    .single();

  if (insertErr || !row) {
    // Roll back the storage object so a failed insert doesn't leak files.
    await supabaseAdmin.storage.from(BUCKET).remove([path]);
    console.error("[admin/reports POST insert]", insertErr?.message);
    return NextResponse.json(
      { error: insertErr?.message ?? "Insert failed" },
      { status: 500 },
    );
  }

  bust(params.id);

  void recordAuditEvent({
    req,
    entity: "product_report",
    action: "create",
    targetId: row.id,
    targetLabel: title,
    context: `Added ${category.toUpperCase()} report "${title}"`,
    meta: {
      product_id: params.id,
      category,
      file_name: row.file_name,
      file_size_bytes: row.file_size_bytes,
      mime_type: row.mime_type,
    },
  });

  return NextResponse.json({ report: row });
}
