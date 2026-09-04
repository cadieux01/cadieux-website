"use client";

import Link from "next/link";
import Image from "next/image";
import { notFound, useRouter } from "next/navigation";
import { useRef, useState, type CSSProperties } from "react";
import {
  PRODUCTS,
  PRODUCT_DETAILS,
  type ProductSlug,
  type ProductMedia,
} from "@/lib/data";

// PRODUCT_DETAILS remains imported so its `description` narrative can
// still fall back when the content-string description is empty (bundled
// editorial voice). The media gallery no longer reads from it — that
// arrives as a server-computed `media` prop that already blends admin
// (products.image_url) + bundled sources.
import { useCart } from "@/context/CartContext";
import { formatNutrientValue } from "@/lib/stat-tiles";
import { flyToCart } from "@/lib/fly-to-cart";
import ReviewSection from "@/components/ReviewSection";
import { ShareButton } from "@/components/ShareButton";
import {
  PRODUCT_REPORT_CATEGORIES,
  PRODUCT_REPORT_CATEGORY_LABEL,
  type ProductReport,
} from "@/lib/product-reports";

const GRAIN = "url(/grain.svg)";

const DIVIDER_STYLE: React.CSSProperties = {
  height: 1,
  background: "rgba(2,70,40,0.25)",
  margin: "48px 0",
  border: 0,
};

// Task F v2 cleanup: pill controls follow FIX 4 pattern —
// unselected = transparent + FG text (border lives on the wrapping container);
// no rgba() alpha backgrounds on interactive controls.
const pdpQtyBtnStyle: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 22,
  lineHeight: 1,
  fontWeight: 400,
  color: "#024628",
  background: "transparent",
  border: "none",
  padding: "10px 16px",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};

export type PdpStrings = {
  name: string;
  tag: string;
  title: string;
  subtitle: string;
  description: string;
  aboutEyebrow: string;
  aboutTitle: string;
  reportsEyebrow: string;
  reportsTitle: string;
  trialsBanner: string;
  outOfStockBanner: string;
};

export type PdpStatTile = {
  id: string;
  tile_key: string;
  value: string;
  label: string;
  sort_order: number;
};

// Shape of a single FAQ row — kept in sync with PdpFaq in the server page
// (imported as `faqs` via props so the client stays server-safe).
export type PdpFaqRow = { q: string; a: string };

// Regulatory label + per-slice nutrition, resolved on the server from
// products.{ingredients, allergens, nutrition_per_slice, slices_per_loaf}.
// Every field is nullable — the render below hides its own section when
// the underlying value is empty, so a partially-filled admin row is fine.
export type PdpLabelInfo = {
  ingredients: string | null;
  allergens: string | null;
  nutritionPerSlice: Record<string, number> | null;
  slicesPerLoaf: number | null;
};

export default function ProductDetailClient({
  slug,
  urlSlug,
  outOfStock = false,
  reports = [],
  ingredients = [],
  price = null,
  pdpStrings,
  statTiles = [],
  media = [],
  heroImage,
  faqs = [],
  labelInfo = null,
}: {
  // Internal slug (`high-protein` | `multigrain`) — the key for PRODUCTS,
  // PRODUCT_DETAILS, and the review scope. Never changes across a URL
  // rename, so historical review data stays attached to the same product.
  slug: string;
  // URL slug (`plain-protein-bread` | `multigrain-protein-bread`) — used
  // only for outbound public links (share button, any deep link back to
  // this page). Kept separate so we can rename URLs again without touching
  // the DB / review scope.
  urlSlug: string;
  outOfStock?: boolean;
  reports?: ProductReport[];
  // DB-driven ingredient names (product_ingredients), ordered. The bundled
  // PRODUCT_DETAILS.ingredients is no longer rendered — this list is the
  // single source of truth, editable from the admin product editor.
  ingredients?: string[];
  // Live DB price (products.price_inr). Falls back to the bundled PRODUCTS
  // price only when the DB read was empty, so display + cart snapshot stay
  // pinned to the products table — the single source of truth.
  price?: number | null;
  // Atomic PDP strings (server-resolved with critical fallbacks).
  pdpStrings?: PdpStrings;
  // Stat tiles, server-resolved from product_stat_tiles with net_weight +
  // slices read through to the products row. NO bundled fallback: when this
  // is empty the strip is not rendered at all.
  statTiles?: PdpStatTile[];
  // Server-resolved gallery media. Blends admin (products.image_url +
  // gallery_urls) with bundled PRODUCT_DETAILS editorial media. MAY be
  // empty — see galleryMedia below.
  media?: ProductMedia[];
  // Server-resolved primary image URL — products.image_url, or null when the
  // admin hasn't uploaded a photo. Null means render the empty state; there
  // is no bundled fallback.
  heroImage?: string | null;
  // FAQ rows resolved on the server (PDP_FAQS in page.tsx). Rendered as a
  // visible <section> so the DOM matches the FAQPage JSON-LD schema
  // Google requires for FAQ rich results.
  faqs?: PdpFaqRow[];
  // Admin-owned regulatory label + per-slice nutrition. Any subset can
  // be null; each of the three sections below hides itself when its own
  // field is empty. Distinct from `ingredients` (structured DB grid).
  labelInfo?: PdpLabelInfo | null;
}) {
  const typedSlug = slug as ProductSlug;
  const product = PRODUCTS.find((p) => p.slug === typedSlug);
  const detail = product ? PRODUCT_DETAILS[typedSlug] : undefined;
  // Server-resolved media is authoritative. When it's empty there genuinely
  // is no admin-uploaded photo for this product, so the gallery renders its
  // empty state — we deliberately do NOT synthesize a tile from a bundled
  // brand asset, which would read as a photo of the loaf.
  const galleryMedia: ProductMedia[] =
    media.length > 0
      ? media
      : heroImage
        ? [{ type: "image", src: heroImage, alt: product?.name || "Product image" }]
        : [];

  // Resolve display strings with PRODUCTS-bundled fallbacks (in case the
  // server didn't pass pdpStrings — e.g. a stale call site).
  const s = pdpStrings;
  const dispTag = s?.tag || product?.tag || "";
  const dispTitle = s?.title || product?.title || "";
  const dispName = s?.name || product?.name || "";
  const dispSubtitle = s?.subtitle || product?.subtitle || "";
  const dispDescription = s?.description || "";
  const dispAboutEyebrow = s?.aboutEyebrow || "Inside the loaf";
  const dispAboutTitle = s?.aboutTitle || "Ingredients";
  const dispReportsEyebrow = s?.reportsEyebrow || "Independently tested";
  const dispReportsTitle = s?.reportsTitle || "Lab Reports & Certifications";
  const dispTrialsBanner = s?.trialsBanner || "Final trials are under process.";
  const dispOutOfStock = s?.outOfStockBanner || "Out of stock";

  const [activeMedia, setActiveMedia] = useState(0);
  const [orderType, setOrderType] = useState<"once" | "sub">("once");
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const { addToCart } = useCart();
  const router = useRouter();
  const addBtnRef = useRef<HTMLButtonElement>(null);

  if (!product || !detail) {
    notFound();
  }

  const productIndex = PRODUCTS.findIndex((p) => p.slug === typedSlug);
  const effectivePrice = price ?? product.price;

  const handleAdd = () => {
    if (outOfStock) return;
    // Subscribe flow: open the subscription wizard for this variant instead of
    // dropping it straight into the cart — the user picks weeks/days/window
    // there and we compute the running total from the variant price.
    if (orderType === "sub") {
      // New flow: send users to the multi-step setup wizard. They'll pick the
      // product (and qty / weeks / days / slots) starting at Step 1.
      router.push("/subscriptions/setup");
      return;
    }
    addToCart({
      productIndex,
      name: dispName || product.name,
      price: effectivePrice,
      qty,
      orderType,
    });
    flyToCart(addBtnRef.current);
    setAdded(true);
    setTimeout(() => setAdded(false), 1600);
  };

  return (
    <div style={{ minHeight: "100dvh", background: "#C0C8CE", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />

      <Link
        href="/shop"
        style={{
          position: "fixed",
          top: "calc(24px + env(safe-area-inset-top))",
          left: "calc(20px + env(safe-area-inset-left))",
          zIndex: 101,
          fontFamily: "var(--font-body)",
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: "0.35em",
          textTransform: "uppercase",
          color: "#4369B2",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 16 }}>←</span> Shop
      </Link>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "72px clamp(18px,5vw,64px) 80px",
          maxWidth: 1200,
          margin: "0 auto",
        }}
      >
        {/* Top fold: gallery + info */}
        <div className="pdp-top">
          <Gallery media={galleryMedia} active={activeMedia} onSelect={setActiveMedia} />

          <div className="pdp-info" style={{ minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 14,
                  fontWeight: 500,
                  letterSpacing: "0.35em",
                  textTransform: "uppercase",
                  color: "#024628",
                }}
              >
                {dispTag}
              </div>
              <ShareButton
                title={`${dispTitle} — Cadieux`}
                text={`${dispTitle}. ${dispSubtitle}`}
                url={`https://www.cadieux.in/shop/${urlSlug}`}
                size={36}
              />
            </div>
            <h1
              style={{
                margin: 0,
                fontFamily: "var(--font-heading)",
                fontSize: "clamp(40px, 7vw, 64px)",
                fontWeight: 300,
                color: "#024628",
                lineHeight: 1.05,
                letterSpacing: "0.01em",
              }}
            >
              {dispTitle}
            </h1>
            <p
              style={{
                margin: "18px 0 28px",
                fontFamily: "var(--font-body)",
                fontSize: 16,
                lineHeight: 1.65,
                fontWeight: 300,
                color: "#024628",
                maxWidth: 460,
              }}
            >
              {dispSubtitle}
            </p>

            {/* Stat strip is DB-only. No bundled fallback: an empty strip is
                correct, a hardcoded number on a food label is not. */}
            {statTiles.length > 0 && (
            <div
              className={
                statTiles.length > 3
                  ? "pdp-stat-strip pdp-stat-strip--wrap"
                  : "pdp-stat-strip"
              }
              // The track count is the tile count, not a hardcoded three. The
              // wrap behaviour lives in CSS (see .pdp-stat-strip) because it
              // has to react to the container's width, which inline styles
              // cannot see.
              style={{ "--strip-tiles": statTiles.length } as CSSProperties}
            >
              {statTiles.map((tile) => (
                <div key={tile.id}>
                  <div
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontSize: 26,
                      fontWeight: 500,
                      color: "#024628",
                      lineHeight: 1,
                    }}
                  >
                    {tile.value}
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontFamily: "var(--font-body)",
                      fontSize: 14,
                      fontWeight: 500,
                      letterSpacing: "0.22em",
                      textTransform: "uppercase",
                      color: "#024628",
                    }}
                  >
                    {tile.label}
                  </div>
                </div>
              ))}
            </div>
            )}

            <p
              style={{
                marginTop: -20,
                marginBottom: 32,
                fontFamily: "var(--font-body)",
                fontSize: 16,
                fontWeight: 400,
                letterSpacing: "0.04em",
                color: "#1D1D1F",
              }}
            >
              {dispTrialsBanner}
            </p>

            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 20 }}>
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 42,
                  fontWeight: 500,
                  color: "#024628",
                  lineHeight: 1,
                }}
              >
                ₹{effectivePrice}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 16,
                  fontWeight: 400,
                  color: "#024628",
                }}
              >
                {orderType === "sub" ? "per delivery" : "one-time"}
              </div>
            </div>

            {/* Order type toggle — FIX 4: selected=solid FG+ash label, unselected=transparent+FG+FG border */}
            <div
              style={{
                display: "inline-flex",
                padding: 4,
                borderRadius: 999,
                border: "1px solid #024628",
                background: "transparent",
                marginBottom: 18,
              }}
            >
              {(["once", "sub"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setOrderType(type)}
                  style={{
                    padding: "8px 18px",
                    borderRadius: 999,
                    border: "none",
                    background: orderType === type ? "#024628" : "transparent",
                    color: orderType === type ? "#C0C8CE" : "#024628",
                    fontFamily: "var(--font-body)",
                    fontSize: 14,
                    fontWeight: 500,
                    letterSpacing: "0.28em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                >
                  {type === "once" ? "Buy Once" : "Subscribe"}
                </button>
              ))}
            </div>

            {outOfStock && (
              <div
                role="status"
                style={{
                  marginBottom: 14,
                  padding: "10px 14px",
                  fontFamily: "var(--font-body)",
                  fontSize: 14,
                  fontWeight: 500,
                  letterSpacing: "0.25em",
                  textTransform: "uppercase",
                  color: "#fecaca",
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.45)",
                  borderRadius: 4,
                }}
              >
                {dispOutOfStock}
              </div>
            )}
            {/* Quantity — one-time orders only (subscriptions set their
                quantity inside the setup wizard). */}
            {orderType === "once" && !outOfStock && (
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                <span
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 14,
                    fontWeight: 500,
                    letterSpacing: "0.3em",
                    textTransform: "uppercase",
                    color: "#024628",
                  }}
                >
                  Quantity
                </span>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    border: "1px solid #024628",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  <button
                    type="button"
                    aria-label="Decrease quantity"
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    style={pdpQtyBtnStyle}
                  >
                    −
                  </button>
                  <span
                    aria-live="polite"
                    style={{
                      minWidth: 40,
                      textAlign: "center",
                      fontFamily: "var(--font-body)",
                      fontSize: 16,
                      fontWeight: 600,
                      color: "#024628",
                    }}
                  >
                    {qty}
                  </span>
                  <button
                    type="button"
                    aria-label="Increase quantity"
                    onClick={() => setQty((q) => Math.min(99, q + 1))}
                    style={pdpQtyBtnStyle}
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button
                ref={addBtnRef}
                onClick={handleAdd}
                disabled={outOfStock}
                aria-disabled={outOfStock}
                style={{
                  flex: "1 1 220px",
                  padding: "16px 26px",
                  background: added ? "#024628" : "transparent",
                  border: "1px solid #024628",
                  color: added ? "#FBF3D4" : "#024628",
                  opacity: outOfStock ? 0.5 : 1,
                  fontFamily: "var(--font-body)",
                  fontSize: 14,
                  fontWeight: 500,
                  letterSpacing: "0.35em",
                  textTransform: "uppercase",
                  cursor: outOfStock ? "not-allowed" : "pointer",
                  borderRadius: 4,
                  transition: "background 0.3s ease",
                }}
              >
                {outOfStock
                  ? "Out of Stock"
                  : added
                  ? "Added ✓"
                  : orderType === "sub"
                  ? "Set Up Subscription"
                  : "Add to Cart"}
              </button>
            </div>

            <div style={{ marginTop: 32 }}>
              {(dispDescription
                ? dispDescription.split(/\n\n+/)
                : detail.description
              ).map((para, i) => (
                <p
                  key={i}
                  style={{
                    margin: "0 0 14px",
                    fontFamily: "var(--font-body)",
                    fontSize: 16,
                    lineHeight: 1.75,
                    fontWeight: 300,
                    color: "#024628",
                  }}
                >
                  {para}
                </p>
              ))}
            </div>
          </div>
        </div>

        <LabelInfoSections labelInfo={labelInfo} />

        {ingredients.length > 0 && (
          <>
            <hr style={DIVIDER_STYLE} />

            {/* Ingredients — DB-driven (product_ingredients table). */}
            <Section label={dispAboutEyebrow} title={dispAboutTitle}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 20,
                }}
              >
                {ingredients.map((name) => (
                  <div
                    key={name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      padding: "18px 18px",
                      background: "transparent",
                      border: "1px solid rgba(2,70,40,0.25)",
                      borderRadius: 8,
                    }}
                  >
                    <span
                      style={{
                        flex: "0 0 8px",
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "#024628",
                      }}
                    />
                    <div
                      style={{
                        minWidth: 0,
                        fontFamily: "var(--font-heading)",
                        fontSize: 18,
                        color: "#024628",
                        lineHeight: 1.2,
                      }}
                    >
                      {name}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          </>
        )}

        {reports.length > 0 ? (
          <>
            <hr style={DIVIDER_STYLE} />
            <Section label={dispReportsEyebrow} title={dispReportsTitle}>
              <div
                style={{
                  marginBottom: 24,
                  padding: "12px 16px",
                  border: "1px solid rgba(2,70,40,0.25)",
                  borderRadius: 4,
                  fontFamily: "var(--font-body)",
                  fontSize: 16,
                  fontWeight: 400,
                  letterSpacing: "0.04em",
                  color: "#1D1D1F",
                  background: "transparent",
                }}
              >
                {dispTrialsBanner}
              </div>
              <ReportsList reports={reports} />
            </Section>
            <hr style={DIVIDER_STYLE} />
          </>
        ) : (
          <hr style={DIVIDER_STYLE} />
        )}

        {/* FAQ — visible HTML that mirrors the FAQPage JSON-LD schema
            emitted by the server page. Google's rich-result guidelines
            require the visible answer text to match the schema answer
            exactly (they crawl the DOM to verify), so both the schema
            and this section render from the same PDP_FAQS list.
            Rendered as an accessible <details>/<summary> so the answer
            text is in the initial HTML (indexable) but collapsed by
            default for a clean visual layout. */}
        {faqs.length > 0 ? (
          <>
            <Section label="Frequently asked" title="Common questions">
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {faqs.map((f, i) => (
                  <details
                    key={i}
                    style={{
                      background: "transparent",
                      border: "1px solid rgba(2,70,40,0.2)",
                      borderRadius: 8,
                      padding: "14px 18px",
                    }}
                  >
                    <summary
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: 16,
                        fontWeight: 500,
                        color: "#024628",
                        letterSpacing: "0.01em",
                        cursor: "pointer",
                        listStyle: "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <span>{f.q}</span>
                      <span
                        aria-hidden="true"
                        style={{
                          fontSize: 18,
                          lineHeight: 1,
                          color: "rgba(2,70,40,0.55)",
                        }}
                      >
                        +
                      </span>
                    </summary>
                    <p
                      style={{
                        margin: "12px 0 0",
                        fontFamily: "var(--font-body)",
                        fontSize: 16,
                        lineHeight: 1.6,
                        fontWeight: 300,
                        color: "#024628",
                      }}
                    >
                      {f.a}
                    </p>
                  </details>
                ))}
              </div>
            </Section>
            <hr style={DIVIDER_STYLE} />
          </>
        ) : null}

        {/* Reviews */}
        <Section label="What customers say" title="Customer Reviews">
          <ReviewSection productSlug={slug} scope="product" />
        </Section>
      </div>

      <style jsx>{`
        .pdp-top {
          display: grid;
          grid-template-columns: 1fr;
          gap: 32px;
          align-items: start;
        }
        /* The stat strip below wraps on the width of THIS column, not the
           viewport. The two are not the same thing and do not even move in
           the same direction: at 768px this column is the full content width
           (~728px), and at 1024px the layout has split in two so the column
           is NARROWER (~440px) than it was on the smaller screen. A viewport
           media query would get that backwards. */
        .pdp-info {
          container-type: inline-size;
          container-name: pdp-info;
        }
        /* Stat strip. One track per tile -- the count comes from
           --strip-tiles, it is not fixed at three, so a fourth tile has
           somewhere to go. Tracks stay content-sized (auto) with
           space-between, which is the rhythm the three-tile strip has always
           had.

           Equal fractions were tried here and rejected, and must stay
           rejected for the one-row case: three 1fr columns in a 351px
           container give each tile ~117px against a 139px tracked
           "PROTEIN/SLICE" label, and "/" is not a line-break opportunity, so
           the label spilled into its neighbour. */
        .pdp-stat-strip {
          display: grid;
          grid-template-columns: repeat(var(--strip-tiles), auto);
          justify-content: space-between;
          gap: 12px;
          padding: 18px 0;
          border-top: 1px solid rgba(2, 70, 40, 0.25);
          border-bottom: 1px solid rgba(2, 70, 40, 0.25);
          margin-bottom: 32px;
        }
        /* Four or more tiles measure ~466px across and cannot share a row in
           a narrow column, so they START as an even 2-up (2x2 for four) and
           only straighten into a single row once the container proves it has
           the room. Two columns in a 351px container is ~170px each, wider
           than the 139px label, so the spill above cannot happen here.

           Starting narrow rather than wide is deliberate: browsers without
           @container support keep the 2-up, which is merely less elegant.
           The other way round they would keep a single row that does not
           fit. Three tiles never take this class -- they measure 341px and
           have always fitted the narrowest column we render. */
        .pdp-stat-strip--wrap {
          grid-template-columns: 1fr 1fr;
        }
        @container pdp-info (min-width: 480px) {
          .pdp-stat-strip--wrap {
            grid-template-columns: repeat(var(--strip-tiles), auto);
          }
        }
        :global(.pdp-main-media) {
          aspect-ratio: 1 / 1;
        }
        @media (min-width: 900px) {
          .pdp-top {
            grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
            gap: 56px;
          }
          :global(.pdp-main-media) {
            aspect-ratio: 4 / 5;
          }
        }
      `}</style>
    </div>
  );
}

function Gallery({
  media,
  active,
  onSelect,
}: {
  media: ProductMedia[];
  active: number;
  onSelect: (i: number) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const handleScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx !== active) onSelect(idx);
  };

  const goTo = (i: number) => {
    const el = scrollerRef.current;
    if (!el) {
      onSelect(i);
      return;
    }
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  // No admin-uploaded photo for this product yet. Hold the layout with a
  // neutral placeholder rather than a decorative brand shot.
  if (media.length === 0) {
    return (
      <div style={{ minWidth: 0 }}>
        <div
          className="pdp-main-media"
          style={{
            position: "relative",
            width: "100%",
            background: "#024628",
            borderRadius: 14,
            overflow: "hidden",
            border: "1px solid rgba(2,70,40,0.25)",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              textAlign: "center",
              fontFamily: "var(--font-body)",
              fontSize: 14,
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              color: "rgba(251,243,212,0.65)",
            }}
          >
            Photography coming soon
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minWidth: 0 }}>
      <div
        className="pdp-main-media"
        style={{
          position: "relative",
          width: "100%",
          background: "#1a1510",
          borderRadius: 14,
          overflow: "hidden",
          border: "1px solid rgba(2,70,40,0.25)",
        }}
      >
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="pdp-scroller"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            overflowX: "auto",
            overflowY: "hidden",
            scrollSnapType: "x mandatory",
            scrollbarWidth: "none",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {media.map((m, i) => (
            <div
              key={i}
              style={{
                flex: "0 0 100%",
                width: "100%",
                height: "100%",
                scrollSnapAlign: "center",
                position: "relative",
                background: "#1a1510",
              }}
            >
              {m.type === "video" ? (
                <video
                  autoPlay
                  muted
                  loop
                  playsInline
                  poster={m.src.replace(/\.mp4$/, ".poster.jpg")}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    backgroundColor: "#1a1510",
                    display: "block",
                    pointerEvents: "none",
                  }}
                >
                  <source src={m.src.replace(/\.mp4$/, ".av1.mp4")} type='video/mp4; codecs="av01.0.05M.08"' />
                  <source src={m.src} type="video/mp4" />
                </video>
              ) : (
                <Image
                  src={m.src}
                  alt={m.alt || "Product image"}
                  fill
                  draggable={false}
                  sizes="(max-width: 768px) 100vw, 800px"
                  priority={i === 0}
                  style={{
                    objectFit: "cover",
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Swipe hint — only on first item. FIX 4: solid cream pill + FG label + FG border (readable on any photo). */}
        {media.length > 1 && active === 0 && (
          <div
            style={{
              position: "absolute",
              top: 14,
              left: 14,
              fontFamily: "var(--font-body)",
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "#024628",
              padding: "6px 12px",
              background: "#FBF3D4",
              border: "1px solid #024628",
              borderRadius: 4,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              pointerEvents: "none",
            }}
          >
            Swipe <span aria-hidden="true">→</span>
          </div>
        )}

        {/* Dot indicators */}
        {media.length > 1 && (
          <div
            style={{
              position: "absolute",
              bottom: 12,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "center",
              gap: 6,
              pointerEvents: "none",
            }}
          >
            {media.map((_, i) => (
              <span
                key={i}
                style={{
                  width: i === active ? 20 : 6,
                  height: 6,
                  borderRadius: 999,
                  background: i === active ? "#024628" : "rgba(2,70,40,0.6)",
                  transition: "all 0.25s ease",
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          marginTop: 14,
          overflowX: "auto",
          paddingBottom: 4,
        }}
      >
        {media.map((m, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            style={{
              flex: "0 0 auto",
              width: 74,
              height: 92,
              padding: 0,
              border: `1.5px solid ${i === active ? "#024628" : "rgba(2,70,40,0.25)"}`,
              borderRadius: 8,
              overflow: "hidden",
              cursor: "pointer",
              background: "#1a1510",
              opacity: i === active ? 1 : 0.72,
              transition: "opacity 0.2s ease, border-color 0.2s ease",
            }}
            aria-label={`Show media ${i + 1}`}
          >
            {m.type === "video" ? (
              <video
                muted
                playsInline
                poster={m.src.replace(/\.mp4$/, ".poster.jpg")}
                preload="none"
                style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
              >
                <source src={m.src.replace(/\.mp4$/, ".av1.mp4")} type='video/mp4; codecs="av01.0.05M.08"' />
                <source src={m.src} type="video/mp4" />
              </video>
            ) : (
              <Image
                src={m.src}
                alt={m.alt || ""}
                width={148}
                height={184}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            )}
          </button>
        ))}
      </div>

      <style jsx>{`
        .pdp-scroller::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}

// Regulatory label + per-slice nutrition + allergens. Each of the three
// sub-sections renders ONLY when its own field is non-empty, and each
// gets its own divider so a partially-filled row still looks clean. The
// section keys (protein_g etc.) are DB-owned — canonical *_g suffixes
// get stripped + title-cased with a "g" unit; `calories` renders "kcal";
// other custom keys render title-cased with no unit.
function LabelInfoSections({ labelInfo }: { labelInfo: PdpLabelInfo | null }) {
  if (!labelInfo) return null;
  const { ingredients, allergens, nutritionPerSlice, slicesPerLoaf } = labelInfo;
  const ingText = (ingredients ?? "").trim();
  const allergText = (allergens ?? "").trim();
  const nutriEntries = nutritionPerSlice
    ? Object.entries(nutritionPerSlice).filter(
        ([, v]) => typeof v === "number" && Number.isFinite(v),
      )
    : [];
  if (!ingText && !allergText && nutriEntries.length === 0) return null;

  const nutriSubtitle =
    typeof slicesPerLoaf === "number" && slicesPerLoaf > 0
      ? `Values per single slice (approx. ${slicesPerLoaf} slices per loaf).`
      : "Values per single slice.";

  return (
    <>
      {ingText ? (
        <>
          <hr style={DIVIDER_STYLE} />
          <Section label="On the label" title="Ingredients">
            <p
              style={{
                margin: 0,
                fontFamily: "var(--font-body)",
                fontSize: 16,
                lineHeight: 1.75,
                fontWeight: 300,
                color: "#024628",
                whiteSpace: "pre-wrap",
                maxWidth: 720,
              }}
            >
              {ingText}
            </p>
          </Section>
        </>
      ) : null}

      {nutriEntries.length > 0 ? (
        <>
          <hr style={DIVIDER_STYLE} />
          <Section label="Nutrition" title="Per slice">
            <p
              style={{
                margin: "-16px 0 20px",
                fontFamily: "var(--font-body)",
                fontSize: 16,
                lineHeight: 1.6,
                fontWeight: 300,
                color: "rgba(2,70,40,0.7)",
              }}
            >
              {nutriSubtitle}
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                columnGap: 24,
                rowGap: 0,
                maxWidth: 480,
                border: "1px solid rgba(2,70,40,0.25)",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              {nutriEntries.map(([key, value], i) => {
                const { label, unit } = formatNutrientKey(key);
                const isLast = i === nutriEntries.length - 1;
                const cellStyle: React.CSSProperties = {
                  padding: "14px 18px",
                  fontFamily: "var(--font-body)",
                  fontSize: 16,
                  color: "#024628",
                  borderBottom: isLast ? "none" : "1px solid rgba(2,70,40,0.15)",
                };
                return (
                  <div key={key} style={{ display: "contents" }}>
                    <div style={{ ...cellStyle, fontWeight: 400 }}>{label}</div>
                    <div
                      style={{
                        ...cellStyle,
                        textAlign: "right",
                        fontWeight: 500,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatNutrientValue(value)}
                      {unit ? ` ${unit}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        </>
      ) : null}

      {allergText ? (
        <>
          <hr style={DIVIDER_STYLE} />
          <Section label="Good to know" title="Allergen info">
            <p
              style={{
                margin: 0,
                fontFamily: "var(--font-body)",
                fontSize: 16,
                lineHeight: 1.7,
                fontWeight: 300,
                color: "rgba(2,70,40,0.75)",
                whiteSpace: "pre-wrap",
                maxWidth: 720,
              }}
            >
              {allergText}
            </p>
          </Section>
        </>
      ) : null}
    </>
  );
}

// Turn a DB nutrient key into a display label + unit.
//   `protein_g` → { label: "Protein", unit: "g" }
//   `calories`  → { label: "Calories", unit: "kcal" }
//   `custom`    → { label: "Custom",  unit: "" }
function formatNutrientKey(key: string): { label: string; unit: string } {
  if (key === "calories") return { label: "Calories", unit: "kcal" };
  const stripped = key.endsWith("_g") ? key.slice(0, -2) : key;
  const label = stripped
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
  const unit = key.endsWith("_g") ? "g" : "";
  return { label: label || key, unit };
}

function Section({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <div
        style={{
          fontFamily: "var(--font-body)",
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: "0.4em",
          textTransform: "uppercase",
          color: "#024628",
          marginBottom: 12,
        }}
      >
        {label}
      </div>
      <h2
        style={{
          margin: "0 0 28px",
          fontFamily: "var(--font-heading)",
          fontSize: "clamp(32px, 5vw, 48px)",
          fontWeight: 300,
          color: "#024628",
          letterSpacing: "0.01em",
          lineHeight: 1.1,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function ReportsList({ reports }: { reports: ProductReport[] }) {
  // Group by the canonical category order so FSSAI shows above Other.
  const grouped = PRODUCT_REPORT_CATEGORIES.map((cat) => ({
    category: cat,
    rows: reports.filter((r) => r.category === cat),
  })).filter((g) => g.rows.length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {grouped.map((group) => (
        <div key={group.category}>
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: "#024628",
              marginBottom: 12,
            }}
          >
            {PRODUCT_REPORT_CATEGORY_LABEL[group.category]}
          </div>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 12,
            }}
          >
            {group.rows.map((r) => (
              <li key={r.id}>
                <a
                  href={r.file_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "block",
                    padding: "14px 16px",
                    border: "1px solid rgba(2,70,40,0.25)",
                    background: "transparent",
                    textDecoration: "none",
                    color: "#024628",
                  }}
                >
                  {r.report_number ? (
                    <div
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: 14,
                        letterSpacing: "0.12em",
                        color: "#024628",
                        marginBottom: 4,
                      }}
                    >
                      {r.report_number}
                    </div>
                  ) : null}
                  <div
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: 16,
                      fontWeight: 500,
                      letterSpacing: "0.02em",
                      marginBottom: 6,
                    }}
                  >
                    {r.report_name ?? r.title}
                  </div>
                  {r.summary ? (
                    <div
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: 16,
                        lineHeight: 1.5,
                        color: "#024628",
                        marginBottom: 8,
                      }}
                    >
                      {r.summary}
                    </div>
                  ) : null}
                  <div
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: 14,
                      letterSpacing: "0.2em",
                      textTransform: "uppercase",
                      color: "#024628",
                    }}
                  >
                    View {fileKind(r.mime_type)} →
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function fileKind(mime: string | null): string {
  if (!mime) return "File";
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return "Image";
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/msword"
  ) {
    return "Document";
  }
  return "File";
}

