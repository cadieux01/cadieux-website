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
  // Bucket row IS set (applied 2026-10-13): file_size_limit = 52428800 and
  // allowed_mime_types = exactly these three. The values below are therefore
  // a MIRROR of an enforceable server-side gate, not the gate itself.
  //
  // IT USED TO BE null/null, AND null IS NOT THE SAME NUMBER AS ANYTHING.
  // A null file_size_limit does not mean "no limit" — it means the ceiling
  // falls through to a project-wide setting that is invisible from this
  // repo and editable in the dashboard. Probed before the change: 52,428,800
  // accepted, 52,428,801 -> 413 EntityTooLarge. That ceiling was real, but
  // nothing in version control said so, and the rule at the top of this file
  // is that both sides hold the SAME number. So the bucket row now states it.
  // product-images above already carried 52428800 plus its own explicit mime
  // list, so null/null here was the odd one out, not the house style.
  //
  // THREE NUMBERS MOVE TOGETHER, NONE OF THEM ALONE: this constant, MAX_BYTES
  // in api/admin/products/[id]/reports/route.ts, and storage.buckets. Change
  // one and you get the failure mode the header warns about.
  //
  // WHY NOT PDF-ONLY. Lab reports arrive as phone photos and flatbed scans at
  // least as often as PDFs. A PDF-only bucket bounces those at the gate with
  // an error the uploader cannot act on, so jpeg and png are first-class here
  // — which is also why the object name must carry the file's REAL extension
  // (see extByMime) rather than a hardcoded .pdf.
  "product-reports": {
    maxBytes: 50 * 1024 * 1024, // 52,428,800 — binary, equal to the bucket
    mimes: ["application/pdf", "image/jpeg", "image/png"],
    extByMime: {
      "application/pdf": "pdf",
      "image/jpeg": "jpg",
      "image/png": "png",
    },
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
    // The byte count is not decoration. Both sides round to one decimal, so a
    // file one byte over the ceiling otherwise reads "File is 50.0 MB — the
    // limit is 50.0 MB.", which tells the operator nothing.
    const over = file.size - limits.maxBytes;
    return `File is ${formatUploadBytes(file.size)} — the limit is ${formatUploadBytes(limits.maxBytes)}. Over by ${over.toLocaleString("en-US")} B.`;
  }
  if (file.size === 0) return "That file is empty (0 bytes).";
  return null;
}
