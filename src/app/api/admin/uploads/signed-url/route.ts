import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { queueAuditEvent } from "@/lib/audit-log";
import { hasValidPinGrant } from "@/lib/pin-grant";
import {
  UPLOAD_LIMITS,
  checkUploadFile,
  isUploadBucket,
} from "@/lib/upload-limits";

// POST /api/admin/uploads/signed-url
//
// Mints a one-shot signed upload URL so the browser PUTs the bytes STRAIGHT
// to Supabase Storage. This exists because Vercel rejects any function
// request body over ~4.5 MB AT THE EDGE, before the handler runs — measured
// on prod: 4,400,000 B reached our 401, 4,500,000 B came back
// 413 FUNCTION_PAYLOAD_TOO_LARGE. So the old multipart routes could never
// accept a large photo and could never accept a video at all, whatever their
// own MAX_BYTES said. Only the file METADATA passes through this function
// (a few hundred bytes of JSON), so the cap stops applying.
//
// What this route is NOT: it is not the size/mime control. The signed URL
// lets the browser talk to storage directly, so after this response the
// client's claims are unverifiable — see src/lib/upload-limits.ts for why
// the bucket row is the real gate.

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    bucket?: unknown;
    prefix?: unknown;
    mime?: unknown;
    size?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  if (!isUploadBucket(body.bucket)) {
    return NextResponse.json(
      { error: `Unknown bucket "${String(body.bucket)}"` },
      { status: 400 },
    );
  }
  const bucket = body.bucket;

  // Writing into product-reports changes live PDP content, exactly as the
  // multipart POST /api/admin/products/[id]/reports does — so the PIN grant
  // has to be checked HERE too. Without this, handing out a signed URL for
  // that bucket would be a way around the PIN gate on that route.
  if (bucket === "product-reports" && !hasValidPinGrant(req)) {
    return NextResponse.json(
      { error: "PIN verification required.", code: "pin_required" },
      { status: 401 },
    );
  }

  const mime = typeof body.mime === "string" ? body.mime : "";
  const size = typeof body.size === "number" ? body.size : NaN;
  if (!Number.isFinite(size) || size < 0) {
    return NextResponse.json({ error: "Missing file size" }, { status: 400 });
  }

  const reason = checkUploadFile(bucket, { type: mime, size });
  if (reason) {
    return NextResponse.json({ error: reason }, { status: 400 });
  }

  // Optional folder within the bucket so callers can keep uploads organised
  // (e.g. process-steps/, or a product id for lab reports). Sanitised the
  // same way the legacy multipart route does — never trust the raw value.
  const prefix =
    typeof body.prefix === "string"
      ? body.prefix
          .replace(/[^a-zA-Z0-9/_-]/g, "")
          .replace(/^\/+|\/+$/g, "")
          .slice(0, 64)
      : "";

  const ext = UPLOAD_LIMITS[bucket].extByMime[mime] ?? "bin";
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  const filename = `${stamp}-${rand}.${ext}`;
  const path = prefix ? `${prefix}/${filename}` : filename;

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUploadUrl(path);

  if (error || !data?.signedUrl || !data?.token) {
    console.error("[admin/uploads/signed-url]", error?.message);
    return NextResponse.json(
      { error: error?.message ?? "Could not create upload URL" },
      { status: 500 },
    );
  }

  const { data: pub } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
  if (!pub?.publicUrl) {
    return NextResponse.json(
      { error: "Could not resolve public URL" },
      { status: 500 },
    );
  }

  queueAuditEvent({
    req,
    entity: "product",
    action: "other",
    targetId: path,
    targetLabel: path,
    context: `Issued signed upload URL (${bucket}, ${mime}, ${size} bytes)`,
    meta: { bucket, path, mime, size },
  });

  return NextResponse.json({
    bucket,
    path,
    token: data.token,
    signedUrl: data.signedUrl,
    publicUrl: pub.publicUrl,
  });
}
