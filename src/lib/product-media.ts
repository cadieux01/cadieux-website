// Product media helpers, shared by the admin uploader, the server-side
// gallery mappers in lib/products.ts, and the client renderers.
//
// Deliberately its own dependency-free module rather than part of
// lib/products.ts: that file imports supabase-js and next/cache, so a
// "use client" component cannot import it at all.

/** True when the URL points at a product VIDEO rather than a photo.
 *
 *  The upload route stamps a real extension onto every stored object,
 *  derived from the verified MIME type
 *  (api/admin/products/upload-image/route.ts) — so the extension IS the
 *  type. Nothing at render time has a Content-Type to consult; the gallery
 *  is a list of bare URLs read out of products.gallery_urls. */
export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url);
}

/** MIME to advertise on a <source>.
 *
 *  The gallery used to hardcode "video/mp4" for every entry, which tells
 *  the browser a .webm is an .mp4 — and some browsers refuse the file on
 *  that mismatch alone, with no other source to fall back to. */
export function videoMimeType(url: string): string {
  if (/\.webm(\?|$)/i.test(url)) return "video/webm";
  if (/\.mov(\?|$)/i.test(url)) return "video/quicktime";
  return "video/mp4";
}

/** Cap on products.gallery_urls, enforced by the zod schema on save. The
 *  uploader reads the same number so an over-cap batch is refused at upload
 *  time with a sentence, instead of at save time with a bare 400. */
export const MAX_GALLERY_URLS = 20;

/** Total tiles the uploader holds: the primary (products.image_url) plus
 *  the gallery array. */
export const MAX_PRODUCT_MEDIA = MAX_GALLERY_URLS + 1;

/** Returned by the product write routes when a video is offered as the
 *  primary image.
 *
 *  products.image_url is the one media field the Android app reads, and the
 *  app has no video player — a video there renders as a blank tile in its
 *  shop list. The app also has no over-the-air update path, so that cannot
 *  be corrected without a Play release. Keep videos in the gallery. */
export const COVER_MUST_BE_PHOTO =
  "The primary tile must be a photo, not a video — the shop grid and the app both use it as the cover. Use “Make primary” on a photo, or upload one.";
