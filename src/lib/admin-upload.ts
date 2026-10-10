"use client";

// Client-side upload path for the admin pages.
//
// THE PROBLEM THIS SOLVES. Every admin uploader used to POST the file as
// multipart/form-data to one of our own API routes. Vercel rejects a function
// request body over ~4.5 MB at the EDGE, before the route handler runs, so
// those uploads died with a bare 413 and the route's own MAX_BYTES (50 MB for
// media, 10 MB for reports) was never reachable. Here the browser asks our
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

  const headers = adminAuthHeaders({ "Content-Type": "application/json" });
  if (pinGrant) headers.set("x-pin-grant", pinGrant);

  const res = await fetch("/api/admin/uploads/signed-url", {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({
      bucket,
      prefix: prefix ?? "",
      mime: file.type,
      size: file.size,
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
    file,
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
    mime: file.type,
    size: file.size,
  };
}

/** Human-readable limit for this bucket, for help text. */
export function uploadLimitLabel(bucket: UploadBucket): string {
  const mb = UPLOAD_LIMITS[bucket].maxBytes / (1024 * 1024);
  return `${mb} MB`;
}
