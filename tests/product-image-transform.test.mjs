// Egress fix — the URL rewriter + the "nothing still serves raw"
// invariant. Structural pins so a future refactor can't silently
// reintroduce a raw /storage/v1/object/public/ product-image URL
// behind an <img src> or a list emitter.

import "./_alias-hook.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const code = (rel) =>
  read(rel).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const {
  productImageUrl,
  productImageUrls,
  isSupabasePublicUrl,
} = await import("../src/lib/supabase-image.ts");

const RAW =
  "https://uejagupcwevadfhfuadv.supabase.co/storage/v1/object/public/product-images/1794300716829-z77k90tb.png";

// ── productImageUrl shape ──────────────────────────────────────────

test("rewrites /object/public/ to /render/image/public/ and appends width+quality", () => {
  const out = productImageUrl(RAW, { width: 1600, quality: 80 });
  assert.ok(
    out.includes("/storage/v1/render/image/public/product-images/"),
    "must point at the transform endpoint",
  );
  assert.ok(out.includes("width=1600"));
  assert.ok(out.includes("quality=80"));
});

test("passes non-Supabase URLs through unchanged", () => {
  const bundled = "/icons/icon-512.png";
  assert.equal(productImageUrl(bundled, { width: 1200 }), bundled);
  const external = "https://example.com/foo.jpg";
  assert.equal(productImageUrl(external, { width: 1200 }), external);
  const dataUri = "data:image/jpeg;base64,/9j/";
  assert.equal(productImageUrl(dataUri, { width: 1200 }), dataUri);
});

test("passes video URLs through unchanged — transform endpoint 400s on video", () => {
  const vid = RAW.replace(".png", ".mp4");
  assert.equal(productImageUrl(vid, { width: 1200 }), vid);
});

test("is idempotent — a URL that already has width= is returned unchanged", () => {
  const first = productImageUrl(RAW, { width: 1600 });
  const second = productImageUrl(first, { width: 800 });
  // The ALREADY-chosen width wins (1600). A callers that re-wraps an
  // already-transformed URL does not accidentally produce two width
  // params on the same URL.
  assert.equal(second, first);
  assert.ok(!/width=\d+&width=/.test(second));
});

test("null / empty / undefined input returns empty string without throwing", () => {
  assert.equal(productImageUrl(null, { width: 1200 }), "");
  assert.equal(productImageUrl(undefined, { width: 1200 }), "");
  assert.equal(productImageUrl("", { width: 1200 }), "");
});

test("productImageUrls maps an array", () => {
  const out = productImageUrls([RAW, RAW.replace(".png", ".mp4"), "/local.png"], {
    width: 800,
  });
  assert.equal(out.length, 3);
  assert.ok(out[0].includes("/render/image/public/"));
  assert.equal(out[1], RAW.replace(".png", ".mp4"));
  assert.equal(out[2], "/local.png");
});

test("isSupabasePublicUrl identifies both endpoints", () => {
  assert.equal(isSupabasePublicUrl(RAW), true);
  assert.equal(
    isSupabasePublicUrl(RAW.replace("/object/public/", "/render/image/public/")),
    true,
  );
  assert.equal(isSupabasePublicUrl("/icons/x.png"), false);
  assert.equal(isSupabasePublicUrl(null), false);
});

test("resize parameter is written when provided", () => {
  const out = productImageUrl(RAW, { width: 1200, resize: "cover" });
  assert.ok(out.includes("resize=cover"));
});

// ── Structural: no raw <img src=supabase object/public> in the tree ──

test("no component renders a raw /object/public/ URL for an image — must go through productImageUrl", () => {
  // Walk the src tree once and check every file.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(full);
      } else if (/\.(tsx?|mjs|js)$/.test(entry.name)) {
        const rel = path.relative(ROOT, full);
        // The helper itself carries the literal path string in its
        // definition — allow it. Same for tests + the test alias
        // hook. upload routes also legitimately get the public URL
        // from getPublicUrl() — that returns an /object/public URL
        // which then flows into the DB and is transformed on the way
        // OUT by productImageUrl (via lib/products.ts et al), so the
        // write-side allowance is fine. The read-side rule is the
        // one we're pinning here.
        if (rel === "src/lib/supabase-image.ts") continue;
        if (rel.startsWith("tests/")) continue;
        if (rel.startsWith("supabase/")) continue;
        const src = code(rel);
        // Only flag when the SAME line both constructs an img src
        // AND contains the raw object-public path. Prose comments
        // were stripped above.
        const lines = src.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const hasImgSrc = /<img\s|src=\{/.test(line);
          const hasRawPath = line.includes("/storage/v1/object/public/");
          if (hasImgSrc && hasRawPath) {
            offenders.push(`${rel}:${i + 1}`);
          }
        }
      }
    }
  };
  walk(path.join(ROOT, "src"));
  assert.deepEqual(offenders, [], `raw /object/public/ URLs in img src: ${offenders.join(", ")}`);
});

// ── Structural: emitters call productImageUrl ──────────────────────

test("lib/products.ts wraps emitted image URLs in productImageUrl", () => {
  const src = code("src/lib/products.ts");
  assert.ok(
    /import \{\s*productImageUrl\s*\} from ["']@\/lib\/supabase-image["']/.test(src),
    "products.ts must import productImageUrl",
  );
  // All four public emitters touch productImageUrl somewhere.
  for (const needle of ["resolveHeroImage", "resolveOgImage", "resolveProductMedia", "resolvePdpGallery"]) {
    assert.ok(src.includes(needle), `missing emitter ${needle}`);
  }
  const callCount = (src.match(/productImageUrl\s*\(/g) ?? []).length;
  assert.ok(
    callCount >= 4,
    `expected >= 4 productImageUrl calls in lib/products.ts, got ${callCount}`,
  );
});

test("lib/content.ts rewrites process_steps.image_url — fixes the Android app with no release", () => {
  const src = code("src/lib/content.ts");
  // The one call is on the process_steps read path, which is what
  // /api/mobile/content serves. The app pulls products directly from
  // Supabase (constants/products.ts in CadieuxApp) so THIS is the
  // only in-repo fix that reaches it without a Play release.
  assert.ok(
    /import \{\s*productImageUrl\s*\} from ["']@\/lib\/supabase-image["']/.test(src),
  );
  assert.ok(/productImageUrl\(\s*r\.image_url/.test(src));
});

test("lib/sandwich-menu.ts rewrites imageUrl + galleryUrls", () => {
  const src = code("src/lib/sandwich-menu.ts");
  assert.ok(
    /import \{\s*productImageUrl\s*\} from ["']@\/lib\/supabase-image["']/.test(src),
  );
  assert.ok((src.match(/productImageUrl\s*\(/g) ?? []).length >= 2);
});

// ── Resize-before-upload ───────────────────────────────────────────

test("admin-upload.ts resizes before uploading", () => {
  const src = code("src/lib/admin-upload.ts");
  assert.ok(/maybeResizeImageForUpload/.test(src), "resize helper is gone");
  // uploadViaSignedUrl must actually call it before minting the signed URL.
  const fn = src.slice(src.indexOf("export async function uploadViaSignedUrl"));
  const call = fn.indexOf("maybeResizeImageForUpload");
  const signed = fn.indexOf("/api/admin/uploads/signed-url");
  assert.ok(call > 0, "uploadViaSignedUrl must call the resize helper");
  assert.ok(call < signed, "resize must happen BEFORE requesting the signed URL");
});

test("admin-upload.ts uses the resized file's size + mime for the signed URL request", () => {
  const src = code("src/lib/admin-upload.ts");
  // After resize we store the result as `toUpload`; the signed URL
  // request body must carry toUpload.type + toUpload.size, not
  // file.type + file.size. A regression that sent the original's
  // mime for a resized PNG-→-JPG would stamp a .png path on a JPG
  // blob.
  assert.ok(/mime:\s*toUpload\.type/.test(src));
  assert.ok(/size:\s*toUpload\.size/.test(src));
});

// ── next.config remotePatterns covers the transform endpoint ───────

test("next.config remotePatterns allows the Supabase render/image/public endpoint", () => {
  const src = read("next.config.js");
  assert.ok(
    src.includes("/storage/v1/render/image/public/**"),
    "next/image refuses to optimise the transform URLs unless this pattern is allowed",
  );
});
