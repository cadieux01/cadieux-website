import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import {
  PRODUCT_REPORT_CATEGORIES,
  ProductReportCategory,
} from "@/lib/product-reports";

// Lab Reports for a single product.
//   GET  → list all (including archived) for the admin UI.
//   POST → multipart upload: file + title + category + optional sort_order.
//
// Storage bucket: product-reports (public). File path is namespaced under
// the product id so cascade-deleting a product makes it obvious to find
// orphaned files: <product_id>/<timestamp>-<rand>.<ext>.

const BUCKET = "product-reports";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/octet-stream",
]);
const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/msword": "doc",
  "application/octet-stream": "bin",
};

const REPORT_SELECT =
  "id, product_id, title, category, file_url, file_name, file_mime, file_size_bytes, storage_path, sort_order, is_archived, uploaded_at, updated_at";

function bust(): void {
  revalidateTag("product-reports");
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("product_reports")
    .select(REPORT_SELECT)
    .eq("product_id", params.id)
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
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported mime "${file.type}".` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${file.size} bytes). Max ${MAX_BYTES}.` },
      { status: 400 },
    );
  }

  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `${params.id}/${stamp}-${rand}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: file.type,
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
      file_mime: file.type,
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

  bust();
  return NextResponse.json({ report: row });
}
