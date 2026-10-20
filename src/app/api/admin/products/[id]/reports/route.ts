import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { queueAuditEvent } from "@/lib/audit-log";
import { hasValidPinGrant } from "@/lib/pin-grant";
import {
  PRODUCT_REPORT_CATEGORIES,
  ProductReportCategory,
  productReportsTag,
} from "@/lib/product-reports";
import { UPLOAD_LIMITS } from "@/lib/upload-limits";

// Lab Reports for a single product.
//   GET  → list all (incl. archived when ?include_archived=1).
//   POST → multipart upload: file + title + category + optional sort_order.
//
// Storage bucket: product-reports (public). File path is namespaced
// under the product id so a cascading product delete makes orphan
// files easy to spot: <product_id>/<timestamp>-<rand>.<ext>.

const BUCKET = "product-reports";
// Must equal UPLOAD_LIMITS["product-reports"].maxBytes AND the bucket row's
// file_size_limit. See src/lib/upload-limits.ts — three numbers, one value.
const MAX_BYTES = UPLOAD_LIMITS["product-reports"].maxBytes;
// Reports are not PDF-only: phone photos and flatbed scans are normal.
const ALLOWED_MIME = UPLOAD_LIMITS["product-reports"].mimes;

function mimeRefusal(mime: string): string | null {
  if (ALLOWED_MIME.includes(mime)) return null;
  return `File must be a PDF, JPEG or PNG${mime ? ` (got "${mime}")` : ""}`;
}

const REPORT_SELECT =
  "id, product_id, title, report_number, report_name, summary, category, file_url, file_name, mime_type, file_size_bytes, storage_path, sort_order, is_archived, uploaded_at, archived_at";

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
  // Lab-report uploads mutate live PDP content — require the security PIN
  // grant (header `x-pin-grant` or `pin_verified` cookie), same gate as the
  // product PATCH route.
  if (!hasValidPinGrant(req)) {
    return NextResponse.json(
      { error: "PIN verification required.", code: "pin_required" },
      { status: 401 },
    );
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

  // TWO BODY SHAPES.
  //
  //   application/json  — the browser already PUT the PDF straight to
  //     storage with a signed upload URL (POST /api/admin/uploads/signed-url)
  //     and sends only metadata here. This is the path that works for a big
  //     file: Vercel rejects a function request body over ~4.5 MB AT THE EDGE
  //     before this handler runs, so MAX_BYTES below was never reachable from
  //     the multipart path and a 10 MB report could not be uploaded at all.
  //     (MAX_BYTES is 50 MiB now; the edge cap is unchanged.)
  //
  //   multipart/form-data — the original path, kept so nothing breaks while
  //     the new one proves itself. Same ~4.5 MB ceiling as before.
  //
  // Both end in the same insert, with the same PIN gate above and the same
  // storage rollback if the insert fails.
  const isJsonBody = (req.headers.get("content-type") ?? "").includes(
    "application/json",
  );

  let reportName: string;
  let reportNumber: string;
  let summary: string;
  let category: ProductReportCategory;
  let sortOrder: number;
  let path: string;
  let fileName: string;
  let fileMime: string;
  let fileSize: number;

  if (isJsonBody) {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
    }
    const str = (k: string) => String(body[k] ?? "").trim();
    reportName = str("report_name");
    reportNumber = str("report_number");
    summary = str("summary");
    category = (str("category") || "other") as ProductReportCategory;
    sortOrder = Number.isFinite(Number(body.sort_order))
      ? Number(body.sort_order)
      : 0;

    path = str("storage_path");
    // Keep the per-product namespace the multipart path established, and
    // refuse a row that would point at some other product's object.
    if (!path || !path.startsWith(`${params.id}/`) || path.includes("..")) {
      return NextResponse.json(
        { error: "storage_path must sit under this product's folder" },
        { status: 400 },
      );
    }

    // Read size and mime from STORAGE, never from the request. After a
    // signed-URL upload the client's claims are unverifiable, and these two
    // numbers are shown to operators and used for the size check below.
    const slash = path.lastIndexOf("/");
    const dir = path.slice(0, slash);
    const base = path.slice(slash + 1);
    const { data: listed, error: listErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(dir, { search: base, limit: 100 });
    if (listErr) {
      return NextResponse.json({ error: listErr.message }, { status: 500 });
    }
    const object = (listed ?? []).find((o) => o.name === base);
    if (!object) {
      return NextResponse.json(
        { error: "That upload is not in storage — try uploading again." },
        { status: 400 },
      );
    }
    const meta = (object.metadata ?? {}) as {
      size?: number;
      mimetype?: string;
    };
    fileSize = typeof meta.size === "number" ? meta.size : 0;
    fileMime = typeof meta.mimetype === "string" ? meta.mimetype : "";
    fileName = str("file_name") || base;
  } else {
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
    // Editable fields. report_name is the heading; title is kept for
    // back-compat and defaults to report_name. report_number + summary
    // are optional.
    reportName = String(form.get("report_name") ?? "").trim();
    reportNumber = String(form.get("report_number") ?? "").trim();
    summary = String(form.get("summary") ?? "").trim();
    category = String(form.get("category") ?? "other") as ProductReportCategory;
    const sortRaw = form.get("sort_order");
    sortOrder = Number.isFinite(Number(sortRaw)) ? Number(sortRaw) : 0;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    fileMime = file.type;
    fileSize = file.size;

    const ext = extFromName(file.name);
    const stamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 10);
    path = `${params.id}/${stamp}-${rand}.${ext}`;
    fileName = file.name || `report.${ext}`;

    const badMime = mimeRefusal(fileMime);
    if (badMime) {
      return NextResponse.json({ error: badMime }, { status: 400 });
    }
    if (fileSize > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (${fileSize} bytes). Max ${MAX_BYTES}.` },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: fileMime || "application/octet-stream",
        cacheControl: "31536000",
        upsert: false,
      });
    if (uploadErr) {
      console.error("[admin/reports POST upload]", uploadErr.message);
      return NextResponse.json({ error: uploadErr.message }, { status: 500 });
    }
  }

  // Shared validation. On the JSON path the object is already in storage, so
  // a rejection here has to take it back out — otherwise a bad name or
  // category leaves an orphan PDF behind.
  async function rejectAndClean(
    message: string,
  ): Promise<NextResponse> {
    if (isJsonBody) {
      await supabaseAdmin.storage.from(BUCKET).remove([path]);
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!reportName) {
    return rejectAndClean("Report name is required");
  }
  if (!PRODUCT_REPORT_CATEGORIES.includes(category)) {
    return rejectAndClean(`Invalid category "${category}"`);
  }
  // On the JSON path fileMime came from storage's own recorded mime, so this
  // is a real check and not the client's word.
  const mimeBad = mimeRefusal(fileMime);
  if (mimeBad) {
    return rejectAndClean(mimeBad);
  }
  if (fileSize > MAX_BYTES) {
    return rejectAndClean(
      `File too large (${fileSize} bytes). Max ${MAX_BYTES}.`,
    );
  }

  const title = reportName;

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
      report_name: reportName,
      report_number: reportNumber || null,
      summary: summary || null,
      category,
      file_url: pub.publicUrl,
      file_name: fileName,
      mime_type: fileMime || null,
      file_size_bytes: fileSize,
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

  queueAuditEvent({
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
