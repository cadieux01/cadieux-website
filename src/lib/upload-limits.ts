// Per-bucket upload constraints, shared by the signed-URL route (server) and
// the admin uploaders (client).
//
// WHY THIS FILE EXISTS: with a signed upload URL the browser talks straight to
// Supabase Storage, so the CLIENT claims the mime type and the size. Neither
// claim is trustworthy, and the only place they cannot be forged is the bucket
// row itself. These values therefore have to agree with
// `storage.buckets.file_size_limit` / `allowed_mime_types` — see
// docs below for the exact state. They exist to give the operator a fast,
// readable error instead of a bare 413 from storage; they are NOT the control.
//
// THE 50 MB / 50 MiB TRAP. The storage ceiling is BINARY: 52,428,800 B
// (50 MiB), pinned by probe (52,428,800 -> accepted, 52,428,801 -> 413). Write
// it `50 * 1024 * 1024`, never `50 * 1000 * 1000`, and keep this number equal
// to the bucket's. The gap between the decimal and binary readings is
// 2,428,800 B, and whichever side holds the DECIMAL value is the side that
// refuses that band:
//   - client holds decimal -> client refuses a file storage would accept.
//     Annoying, but safe.
//   - bucket holds decimal -> client permits it, the browser transfers for
//     ~14 s, and THEN storage 413s. This is the bad one.
// Both sides hold 52428800 today, so neither case arises. Keep it that way.

export type UploadBucket = "product-images" | "product-reports";

export interface BucketLimits {
  /** Max bytes. Must equal storage.buckets.file_size_limit where that is set. */
  maxBytes: number;
  /** Accepted mime types. Must be a subset of allowed_mime_types where set. */
  mimes: readonly string[];
  /** Extension by mime, for a human-readable object name. */
  extByMime: Readonly<Record<string, string>>;
}

export const UPLOAD_LIMITS: Readonly<Record<UploadBucket, BucketLimits>> = {
  // Bucket row IS set (applied 2026-10-10): file_size_limit = 52428800 and
  // allowed_mime_types = exactly these six. Mirrors ALLOWED_MIME in
  // api/admin/products/upload-image/route.ts, which has six entries — not the
  // five it is sometimes described as.
  "product-images": {
    maxBytes: 50 * 1024 * 1024, // 52,428,800 — binary, equal to the bucket
    mimes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "video/mp4",
      "video/webm",
      "video/quicktime",
    ],
    extByMime: {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "video/mp4": "mp4",
      "video/webm": "webm",
      "video/quicktime": "mov",
    },
  },
  // Bucket row is still null/null for product-reports — deliberately left
  // alone, because it holds application/pdf objects and the media mime list
  // above would have rejected every one of them. So for THIS bucket the limit
  // below is the only check there is; storage will not second-guess it.
  // 10 MiB matches MAX_BYTES in api/admin/products/[id]/reports/route.ts.
  "product-reports": {
    maxBytes: 10 * 1024 * 1024,
    mimes: ["application/pdf"],
    extByMime: { "application/pdf": "pdf" },
  },
};

export function isUploadBucket(v: unknown): v is UploadBucket {
  return v === "product-images" || v === "product-reports";
}

/** Human-readable byte count for operator-facing errors. */
export function formatUploadBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** Returns an operator-facing reason the file is unacceptable, or null. */
export function checkUploadFile(
  bucket: UploadBucket,
  file: { type: string; size: number },
): string | null {
  const limits = UPLOAD_LIMITS[bucket];
  if (!limits.mimes.includes(file.type)) {
    return `Unsupported file type${file.type ? ` "${file.type}"` : ""}. Allowed: ${limits.mimes.join(", ")}.`;
  }
  if (file.size > limits.maxBytes) {
    return `File is ${formatUploadBytes(file.size)} — the limit is ${formatUploadBytes(limits.maxBytes)}.`;
  }
  if (file.size === 0) return "That file is empty (0 bytes).";
  return null;
}
