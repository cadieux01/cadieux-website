"use client";

// Client-side upload lane for /mkt. Mirrors src/lib/admin-upload.ts in
// shape — browser → signed URL → Supabase Storage — but authenticates
// as the Supabase Auth session (cookie set by /mkt/login), not the
// admin HMAC bearer. Reuses the admin-upload resize helper, which is a
// pure function that neither lane needs to duplicate: the longer this
// repo waits before the second egress leak, the better.

import {
  maybeResizeImageForUpload,
  readAdminError,
} from "@/lib/admin-upload";

export interface MktUploadedObject {
  url: string | null;
  path: string;
  bucket: string;
  mime: string;
  size: number;
}

export interface MktUploadOptions {
  bucket: string;
  prefix?: string;
}

let browserClientPromise: Promise<{
  uploadToSignedUrl: (
    bucket: string,
    path: string,
    token: string,
    file: File,
  ) => Promise<{ error: { message: string } | null }>;
}> | null = null;

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
 * Upload one file to the /mkt lane. RESIZES IMAGES in the browser
 * first (same helper the admin lane uses) and PUTs the resized blob
 * to a signed URL minted by /api/mkt/uploads/signed-url. On image
 * decode failure the original is uploaded — same fail-open shape as
 * the admin lane, and the server-side bucket caps still apply.
 */
export async function mktUploadViaSignedUrl(
  file: File,
  { bucket, prefix }: MktUploadOptions,
): Promise<MktUploadedObject> {
  const toUpload = await maybeResizeImageForUpload(file).catch((e) => {
    console.warn("[mkt-upload] resize skipped for", file.name, e);
    return file;
  });

  const res = await fetch("/api/mkt/uploads/signed-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      bucket,
      prefix: prefix ?? "",
      mime: toUpload.type,
      size: toUpload.size,
    }),
  });
  if (!res.ok) {
    throw new Error(await readAdminError(res, "Could not start upload"));
  }

  const json = (await res.json()) as {
    bucket?: string;
    path?: string;
    token?: string;
    publicUrl?: string | null;
  };
  if (!json.path || !json.token || !json.bucket) {
    throw new Error("Upload URL response was incomplete.");
  }

  const uploader = await getBrowserUploader();
  const { error } = await uploader.uploadToSignedUrl(
    json.bucket,
    json.path,
    json.token,
    toUpload,
  );
  if (error) {
    throw new Error(`${file.name}: ${error.message}`);
  }

  return {
    url: json.publicUrl ?? null,
    path: json.path,
    bucket: json.bucket,
    mime: toUpload.type,
    size: toUpload.size,
  };
}
