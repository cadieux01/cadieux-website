import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";

const BUCKET = "product-images";
// DEAD LIMIT — this number has never been reached and cannot be. It was
// bumped to 50 MB so short product videos (mp4/webm/mov) would fit, but
// Vercel rejects any function request body over ~4.5 MB AT THE EDGE, before
// this handler runs: measured on prod, 4,400,000 B reached our 401 and
// 4,500,000 B came back 413 FUNCTION_PAYLOAD_TOO_LARGE. So the effective
// cap on this route is the platform's ~4.5 MB and the video support it was
// raised for has never worked. The working path is
// POST /api/admin/uploads/signed-url + a direct PUT to storage; this route
// stays only until that has carried real uploads, then it goes.
const MAX_BYTES = 50 * 1024 * 1024; // 50 MiB — unenforceable here, see above
// Product media = images AND videos. Bucket name is legacy ("product-images")
// but the same bucket stores both; the frontend uses the file extension in
// the returned URL to decide how to render each tile.
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

// POST /api/admin/products/upload-image
//   multipart/form-data with a single `file` field. Validates mime + size,
//   uploads to the `product-images` Supabase Storage bucket and returns
//   the public URL. We deliberately don't depend on `sharp` (not in
//   package.json) — the admin is trusted, so we accept the file as-is.
//   LEGACY: only files under the platform's ~4.5 MB body cap ever get
//   here at all; anything larger 413s at the edge. New uploads use the
//   signed-URL path instead.
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      {
        error: `Unsupported mime "${file.type}". Use jpeg/png/webp or mp4/webm/mov.`,
      },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${file.size} bytes). Max ${MAX_BYTES}.` },
      { status: 400 },
    );
  }

  // Optional `prefix` folder within the same bucket so different callers
  // can keep their uploads organised (e.g. process-steps/). Sanitised to a
  // safe slug-ish path segment; empty/absent = bucket root (product images,
  // unchanged). Never trust the raw value — strip anything but [a-z0-9/_-].
  const prefixRaw = form.get("prefix");
  const prefix =
    typeof prefixRaw === "string"
      ? prefixRaw
          .replace(/[^a-zA-Z0-9/_-]/g, "")
          .replace(/^\/+|\/+$/g, "")
          .slice(0, 64)
      : "";

  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  const filename = `${stamp}-${rand}.${ext}`;
  const path = prefix ? `${prefix}/${filename}` : filename;

  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: file.type,
      cacheControl: "31536000",
      upsert: false,
    });

  if (uploadErr) {
    console.error("[admin/products upload-image]", uploadErr.message);
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) {
    return NextResponse.json(
      { error: "Uploaded but could not resolve public URL" },
      { status: 500 },
    );
  }

  void recordAuditEvent({
    req,
    entity: "product",
    action: "other",
    targetId: path,
    targetLabel: path,
    context: `Uploaded product image (${file.type}, ${file.size} bytes)`,
    meta: { bucket: BUCKET, path, mime: file.type, size: file.size },
  });

  return NextResponse.json({ url: pub.publicUrl, path });
}
