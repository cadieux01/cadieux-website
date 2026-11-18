// Supabase Storage image transformation URL helper.
//
// WHY THIS EXISTS. Egress on Supabase (5 GB free cap) was being
// chewed through by product-image originals — a single 15–25 MB JPG
// served raw to every browser and crawler visit. This helper rewrites
// a public object URL to the transformation endpoint, which does the
// resize + re-encode in Supabase's CDN and returns a few hundred KB
// instead of tens of MB.
//
// SHAPE OF A SUPABASE TRANSFORM URL:
//
//   raw:        https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
//   transform:  https://<project>.supabase.co/storage/v1/render/image/public/<bucket>/<path>?width=1600&quality=80
//
// The path, bucket and host are identical — only the URL segment
// `/object/public/` → `/render/image/public/` changes, and the
// transform parameters are appended. Any existing query string is
// preserved.
//
// WHY NOT NEXT/IMAGE ALONE. next/image is wrapped around these URLs
// at every <Image> call site, so the browser gets a Next-optimised
// AVIF/WebP. But Next's optimiser still has to FETCH THE ORIGINAL
// from Supabase on its first miss, and Vercel's image cache on the
// Hobby/Pro tier is not shared across function instances or regions —
// so the first hit to every region is a full 15 MB pull. Routing
// through the transform endpoint makes THAT edge-to-edge hop cheap
// too, because Supabase hands Next a pre-resized ~300 KB payload.
//
// NON-SUPABASE URLS PASS THROUGH. Bundled assets (/icons/*), absolute
// external URLs, data: URIs — anything that isn't a public Supabase
// storage URL is returned unchanged. Callers can wrap any src they
// have without a type-narrowing branch.

export interface TransformOptions {
  /** Target width in CSS pixels. Supabase downscales the longest edge
   *  to fit; the aspect ratio is preserved when `resize` is "contain"
   *  (the default) or "cover". */
  width: number;
  /** 1..100. Omit for Supabase's own default (~75). */
  quality?: number;
  /** "cover" | "contain" | "fill". Default: no param = contain. */
  resize?: "cover" | "contain" | "fill";
}

const OBJECT_PATH = "/storage/v1/object/public/";
const TRANSFORM_PATH = "/storage/v1/render/image/public/";

/** Is this URL a public Supabase Storage object URL we can transform? */
export function isSupabasePublicUrl(url: string | null | undefined): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  return url.includes(OBJECT_PATH) || url.includes(TRANSFORM_PATH);
}

/** Supabase's image transform endpoint only handles raster images
 *  (jpeg/png/webp/gif). Pointing it at a video returns 400 and the
 *  browser shows a broken tile. We check the URL extension — the
 *  upload route stamps a real extension from the verified MIME, so
 *  the extension IS the type. Mirror of isVideoUrl in
 *  @/lib/product-media, inlined here to keep this module
 *  dependency-free. */
function isVideoUrlInternal(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url);
}

/**
 * Rewrite a Supabase public object URL to the transformation endpoint
 * with the given width/quality. Returns non-Supabase URLs unchanged.
 *
 * IDEMPOTENCY: if the URL already points at the transform endpoint
 * AND already carries a width param, it is returned unchanged — so a
 * caller that re-wraps an already-transformed URL doesn't produce
 * `?width=1600&width=800`. The width that was ALREADY there wins.
 */
export function productImageUrl(
  url: string | null | undefined,
  options: TransformOptions,
): string {
  if (typeof url !== "string" || url.length === 0) return url ?? "";
  if (!isSupabasePublicUrl(url)) return url;
  // Videos: the transform endpoint refuses them with 400 and would
  // leave a broken tile. Leave the raw URL alone; the video element's
  // own decoder (or next/image's video branch) handles it.
  if (isVideoUrlInternal(url)) return url;

  const alreadyTransform = url.includes(TRANSFORM_PATH);
  const rewritten = alreadyTransform
    ? url
    : url.replace(OBJECT_PATH, TRANSFORM_PATH);

  // Short-circuit: already has a width param — leave it alone.
  const qIdx = rewritten.indexOf("?");
  const existingQuery = qIdx >= 0 ? rewritten.slice(qIdx + 1) : "";
  if (/(^|&)width=/.test(existingQuery)) return rewritten;

  const params = new URLSearchParams(existingQuery);
  params.set("width", String(Math.round(options.width)));
  if (options.quality !== undefined) {
    params.set("quality", String(Math.round(options.quality)));
  }
  if (options.resize !== undefined) {
    params.set("resize", options.resize);
  }
  const base = qIdx >= 0 ? rewritten.slice(0, qIdx) : rewritten;
  return `${base}?${params.toString()}`;
}

/**
 * Convenience: transform an array in-place-style (returns a new array).
 * Keeps nulls/empty strings as-is so downstream code can still filter.
 */
export function productImageUrls(
  urls: Array<string | null | undefined> | null | undefined,
  options: TransformOptions,
): string[] {
  if (!urls) return [];
  return urls.map((u) => productImageUrl(u, options));
}
