"use client";

// Client-side upload path for the admin pages.
//
// THE PROBLEM THIS SOLVES. Every admin uploader used to POST the file as
// multipart/form-data to one of our own API routes. Vercel rejects a function
// request body over ~4.5 MB at the EDGE, before the route handler runs, so
// those uploads died with a bare 413 and the route's own MAX_BYTES (50 MiB for
// media and for reports alike) was never reachable. Here the browser asks our
// function only for a signed URL — a few hundred bytes of JSON each way — and
// then PUTs the bytes straight to Supabase Storage, which has no such cap.
//
// WHY STANDARD AND NOT RESUMABLE/TUS. Both were measured against the real
// bucket at 5/10/25/50 MB. Standard `uploadToSignedUrl` was faster at every
// size (2.7/4.0/7.8/14.0 s vs 5.2/5.1/10.0/17.2 s) and succeeded all the way
// to the ceiling. TUS's one advantage is refusing an oversized file on the
// declared length before any bytes move (0.2 s vs 13.9 s of wasted upload) —
// and the client guard below gives that for free, at zero bytes, without the
// extra dependency.

import {
  UPLOAD_LIMITS,
  UploadBucket,
  checkUploadFile,
} from "@/lib/upload-limits";
import { adminAuthHeaders } from "@/lib/admin-client";

export interface UploadedObject {
  /** Public URL of the stored object. */
  url: string;
  /** Object path within the bucket — keep this if a row stores it. */
  path: string;
  bucket: UploadBucket;
  mime: string;
  size: number;
}

export interface UploadOptions {
  bucket: UploadBucket;
  /** Folder within the bucket, e.g. "process-steps" or a product id. */
  prefix?: string;
  /** PIN grant, required by the signed-url route for product-reports. */
  pinGrant?: string;
}

// Our error bodies are JSON, but a platform 413 is NOT — Vercel returns
// plain text, and `res.json().catch(() => ({}))` (what every caller used to
// do) threw that text away and left the operator with a bare
// "Upload failed (413)". Read the body as text first, then try to parse it,
// so the real cause always survives.
export async function readAdminError(
  res: Response,
  fallback: string,
): Promise<string> {
  let raw = "";
  try {
    raw = await res.text();
  } catch {
    return `${fallback} (${res.status})`;
  }
  const trimmed = raw.trim();
  if (!trimmed) return `${fallback} (${res.status})`;
  try {
    const parsed = JSON.parse(trimmed) as { error?: string };
    if (parsed && typeof parsed.error === "string" && parsed.error) {
      return parsed.error;
    }
  } catch {
    // Not JSON — fall through and surface the text itself.
  }
  // Cap it: an HTML error page would otherwise flood the UI.
  const text = trimmed.slice(0, 300);
  return `${fallback} (${res.status}): ${text}`;
}

let browserClientPromise: Promise<{
  uploadToSignedUrl: (
    bucket: string,
    path: string,
    token: string,
    file: File,
  ) => Promise<{ error: { message: string } | null }>;
}> | null = null;

// supabase-js is only needed for the few seconds an upload is in flight, so
// it is imported on demand rather than shipped in the admin bundle. The anon
// key is fine here: `uploadToSignedUrl` authenticates with the signed token
// our server minted, which is also why product-images needs no RLS policy.
function getBrowserUploader() {
  if (!browserClientPromise) {
    browserClientPromise = import("@supabase/supabase-js").then(
      ({ createClient }) => {
        const client = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        return {
          uploadToSignedUrl: (
            bucket: string,
            path: string,
            token: string,
            file: File,
          ) =>
            client.storage
              .from(bucket)
              .uploadToSignedUrl(path, token, file, {
                contentType: file.type,
                cacheControl: "31536000",
              }),
        };
      },
    );
  }
  return browserClientPromise;
}

/**
 * Upload one file and return the stored object. Throws with an
 * operator-readable message on any failure.
 *
 * RESIZE-BEFORE-UPLOAD. Any image/jpeg, image/png or image/webp is
 * downscaled in the BROWSER to a longest-edge of UPLOAD_MAX_LONGEST_EDGE
 * (2000 px) and re-encoded at quality 0.80 before the signed URL is
 * even minted. The server-side transform endpoint then serves smaller
 * widths from this already-shrunk master. A 15 MB phone photo lands
 * as ~400-700 KB in the bucket; a 25 MB PNG lands as ~500-900 KB as
 * JPG (PNG is re-encoded as JPG — product photos are opaque, and
 * canvas.toBlob at image/png doesn't honour quality). Videos pass
 * through untouched. If the browser can't decode an image (rare —
 * HEIC on very old devices), we log and upload the original so the
 * operator doesn't lose their work; the per-bucket size cap still
 * applies on the server.
 */
export async function uploadViaSignedUrl(
  file: File,
  { bucket, prefix, pinGrant }: UploadOptions,
): Promise<UploadedObject> {
  // Fast local refusal so an operator who picked a 2 GB file finds out now
  // instead of after a long transfer. This is a courtesy, not the control —
  // the bucket row holds the enforceable limits.
  const reason = checkUploadFile(bucket, file);
  if (reason) throw new Error(`${file.name}: ${reason}`);

  // Resize + re-encode in the browser, then upload the result. On
  // image failure (decode crash, unknown format), fall back to the
  // original so the operator still ships SOMETHING; the oversized
  // file is still subject to the bucket's file_size_limit.
  const toUpload = await maybeResizeImageForUpload(file).catch((e) => {
    console.warn("[admin-upload] resize skipped for", file.name, e);
    return file;
  });

  const headers = adminAuthHeaders({ "Content-Type": "application/json" });
  if (pinGrant) headers.set("x-pin-grant", pinGrant);

  const res = await fetch("/api/admin/uploads/signed-url", {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({
      bucket,
      prefix: prefix ?? "",
      // NB: we send the RESIZED file's mime/size, because the signed
      // URL's path and the server's audit row have to match the bytes
      // we're about to PUT. A PNG that resized to a JPG needs the
      // server to stamp a .jpg path, not the original .png.
      mime: toUpload.type,
      size: toUpload.size,
    }),
  });
  if (!res.ok) {
    throw new Error(await readAdminError(res, "Could not start upload"));
  }

  const json = (await res.json()) as {
    bucket?: UploadBucket;
    path?: string;
    token?: string;
    publicUrl?: string;
  };
  if (!json.path || !json.token || !json.publicUrl) {
    throw new Error("Upload URL response was incomplete.");
  }

  const uploader = await getBrowserUploader();
  const { error } = await uploader.uploadToSignedUrl(
    bucket,
    json.path,
    json.token,
    toUpload,
  );
  if (error) {
    // Storage rejects on the bucket's own file_size_limit /
    // allowed_mime_types, which is the check the client cannot forge.
    throw new Error(`${file.name}: ${error.message}`);
  }

  return {
    url: json.publicUrl,
    path: json.path,
    bucket,
    mime: toUpload.type,
    size: toUpload.size,
  };
}

// ── Upload-time resize ─────────────────────────────────────────────

/** Longest edge in pixels. Chosen to match the website's PDP+shop
 *  render widths (1600 at 2x for retina = 3200, but we never fetch
 *  more than 2000 through the transform endpoint anyway — capping at
 *  2000 saves bucket bytes without hurting any screen we serve). */
export const UPLOAD_MAX_LONGEST_EDGE = 2000;
export const UPLOAD_JPEG_QUALITY = 0.8;

const RESIZABLE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Decode a File into an HTMLImageElement. Rejects on decode failure
 *  (bad format, truncated file) so the caller can fall back to the
 *  original. Uses an object URL + onload rather than createImageBitmap
 *  because older iOS Safari was unreliable on the latter until 16.4. */
function decodeImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

/** Returns a resized + re-encoded File if the input is a
 *  resizable image AND it's actually larger than the target. Otherwise
 *  returns the input unchanged (same identity). */
export async function maybeResizeImageForUpload(file: File): Promise<File> {
  if (!RESIZABLE_MIMES.has(file.type)) return file;
  if (typeof document === "undefined") return file; // SSR safety

  let img: HTMLImageElement;
  try {
    img = await decodeImage(file);
  } catch {
    return file; // fall back to original; see onwards branch below
  }

  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  // Already small enough AND already a well-compressed format (jpg or
  // webp): skip. PNG always re-encodes to JPG — a 2.9 MB PNG we saw
  // in prod becomes ~250 KB JPG at q=0.8 with no visible loss on
  // product photography.
  if (longest <= UPLOAD_MAX_LONGEST_EDGE && file.type !== "image/png") {
    return file;
  }

  // Target dimensions preserving aspect ratio.
  const scale =
    longest > UPLOAD_MAX_LONGEST_EDGE ? UPLOAD_MAX_LONGEST_EDGE / longest : 1;
  const targetW = Math.max(1, Math.round(img.naturalWidth * scale));
  const targetH = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  // High-quality downscale. Canvas 2D does bilinear by default; the
  // smoothing-quality hint moves good browsers to bicubic-ish, which
  // is visibly cleaner on text-bearing labels.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, targetW, targetH);

  // Output mime. Keep webp as webp (lossy webp at 0.8 is smaller than
  // jpg at 0.8 for most photos); jpeg and png both go out as jpeg.
  const outMime = file.type === "image/webp" ? "image/webp" : "image/jpeg";
  const outExt = outMime === "image/webp" ? "webp" : "jpg";

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, outMime, UPLOAD_JPEG_QUALITY),
  );
  if (!blob) return file;

  // If the "optimised" file is BIGGER than the original (rare — a
  // very small or already-compressed source), keep the original.
  if (blob.size >= file.size) return file;

  const base = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${base}.${outExt}`, {
    type: outMime,
    lastModified: Date.now(),
  });
}

/** Human-readable limit for this bucket, for help text. */
export function uploadLimitLabel(bucket: UploadBucket): string {
  const mb = UPLOAD_LIMITS[bucket].maxBytes / (1024 * 1024);
  return `${mb} MB`;
}
