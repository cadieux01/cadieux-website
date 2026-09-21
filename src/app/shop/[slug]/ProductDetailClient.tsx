"use client";

import Image from "next/image";
import { notFound, useRouter } from "next/navigation";
import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import {
  PRODUCTS,
  PRODUCT_DETAILS,
  PRODUCT_UNIT,
  type ProductSlug,
  type ProductMedia,
} from "@/lib/data";

// PRODUCT_DETAILS remains imported so its `description` narrative can
// still fall back when the content-string description is empty (bundled
// editorial voice). The media gallery no longer reads from it — that
// arrives as a server-computed `media` prop that already blends admin
// (products.image_url) + bundled sources.
import { useCart } from "@/context/CartContext";
import { flyToCart } from "@/lib/fly-to-cart";
import {
  CANONICAL_NUTRIENT_KEYS,
  formatNutrient,
  nutrientLabel,
  type NutrientValue,
} from "@/lib/nutrition";
import { videoMimeType } from "@/lib/product-media";
import { costPerGramProtein } from "@/lib/stat-tiles";
import type { PreorderInfo } from "@/lib/product-availability";
import ReviewSection from "@/components/ReviewSection";
import BackLink from "@/components/BackLink";
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

// Whole rupees stay whole; a derived subscribe price that lands on paise
// shows both decimals rather than a long float.
const money = (n: number) =>
  Number.isInteger(n)
    ? n.toLocaleString("en-IN")
    : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type PdpStrings = {
  name: string;
  tag: string;
  title: string;
  subtitle: string;
  description: string;
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
  nutritionPerSlice: Record<string, NutrientValue> | null;
  slicesPerLoaf: number | null;
};

export default function ProductDetailClient({
  slug,
  urlSlug,
  outOfStock = false,
  preorder = null,
  reports = [],
  price = null,
  subscribePrice = null,
  subscribeDiscountPct = null,
  proteinPerLoafG = null,
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
  // Pre-order state, resolved server-side from products.available_from.
  // Orthogonal to outOfStock (products.in_stock): the product is still
  // sellable, it just cannot be delivered before `date`. The date pickers
  // floor to it and the server rejects anything earlier with
  // code "preorder_floor" — this prop is presentation only.
  preorder?: PreorderInfo | null;
  reports?: ProductReport[];
  // Live DB price (products.price_inr). Falls back to the bundled PRODUCTS
  // price only when the DB read was empty, so display + cart snapshot stay
  // pinned to the products table — the single source of truth.
  price?: number | null;
  // DERIVED per-loaf subscribe price (MRP × (1 − discount%)), resolved
  // server-side via getSubscriptionPlans so it is in first paint. Null when
  // this product isn't a subscription plan, or the read failed — the subscribe
  // tab then shows the one-time price, as it always did.
  subscribePrice?: number | null;
  subscribeDiscountPct?: number | null;
  // Grams of protein in a whole loaf, derived server-side from the products
  // row. Null when per-slice protein or slice count is missing — the per-gram
  // line is then omitted rather than guessed.
  proteinPerLoafG?: number | null;
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
  const oneTimePrice = price ?? product.price;

  // The subscribe tab used to render the one-time price under a "per delivery"
  // label, so it told a subscriber ₹160 when they would be charged ₹144. Only
  // advertise the subscribe figure when it is real and actually cheaper;
  // anything else falls back to the one-time price rather than inventing one.
  const hasSubscribePrice =
    typeof subscribePrice === "number" &&
    Number.isFinite(subscribePrice) &&
    subscribePrice > 0 &&
    subscribePrice < oneTimePrice;
  const effectivePrice =
    orderType === "sub" && hasSubscribePrice ? subscribePrice! : oneTimePrice;
  const subPct =
    typeof subscribeDiscountPct === "number" && Number.isFinite(subscribeDiscountPct)
      ? Math.round(subscribeDiscountPct)
      : 0;

  // Per-gram-of-protein price for the price ACTUALLY on screen, so it tracks
  // the tab in the same render as the price itself.
  const perGramProtein = costPerGramProtein(effectivePrice, proteinPerLoafG);

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
      // Always the one-time price. The subscribe path returned above — it
      // never reaches the cart, it goes through the wizard.
      price: oneTimePrice,
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

      <BackLink href="/shop" color="#4369B2">Shop</BackLink>

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
                text={`${dispTitle} — high in protein, slow-fermented, lab-tested. NABL lab reports: https://www.cadieux.in/shop/${urlSlug}/reports`}
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

            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 12,
                // The per-gram line below owns the gap when it renders, so
                // the pair reads as one block rather than two stacked rows.
                marginBottom: perGramProtein !== null ? 6 : 20,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 42,
                  fontWeight: 500,
                  color: "#024628",
                  lineHeight: 1,
                }}
              >
                ₹{money(effectivePrice)}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 16,
                  fontWeight: 400,
                  color: "#024628",
                }}
              >
                {orderType === "sub"
                  ? subPct > 0 && hasSubscribePrice
                    ? `per delivery · ${subPct}% off`
                    : "per delivery"
                  : "one-time"}
              </div>
            </div>

            {perGramProtein !== null && (
              /* Sits under the price, not beside it, and recomputes from
                 whichever price the tab is showing. Two decimals always.
                 Just the unit — no comparison or claim. */
              <div
                style={{
                  marginBottom: 20,
                  fontFamily: "var(--font-body)",
                  fontSize: 14,
                  fontWeight: 400,
                  color: "#024628",
                }}
              >
                ₹{perGramProtein.toFixed(2)} per g protein
              </div>
            )}

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

            {/* Pre-order: the same OUT OF STOCK badge — from the customer's
                side it is out of stock — with the return date under it, and
                the order still takeable. Suppressed when in_stock is false,
                since that banner already says the stronger thing. */}
            {preorder && !outOfStock && (
              <div
                role="status"
                style={{
                  marginBottom: 14,
                  padding: "10px 14px",
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.45)",
                  borderRadius: 4,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 14,
                    fontWeight: 500,
                    letterSpacing: "0.25em",
                    textTransform: "uppercase",
                    color: "#991B1B",
                  }}
                >
                  {dispOutOfStock}
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontFamily: "var(--font-body)",
                    fontSize: 15,
                    lineHeight: 1.45,
                    fontWeight: 400,
                    color: "#024628",
                  }}
                >
                  {preorder.line}
                </div>
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
                  : preorder
                  ? "Pre-order"
                  : "Add to Cart"}
              </button>
            </div>

            {/* "Pre-order now — delivery from <date>." Under the button, so
                the promise is attached to the action the customer is about
                to take. */}
            {preorder && !outOfStock && (
              <div
                style={{
                  marginTop: 10,
                  fontFamily: "var(--font-body)",
                  fontSize: 14,
                  lineHeight: 1.5,
                  fontWeight: 400,
                  color: "#024628",
                }}
              >
                {preorder.buttonNote}
              </div>
            )}

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

        <LabelInfoSections labelInfo={labelInfo} unit={PRODUCT_UNIT[typedSlug]} />

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

  // The index every RELATIVE move computes from. Auto-repeat on a held arrow
  // key fires keydown far faster than React re-renders, so consecutive presses
  // reading the `active` prop would all start from the same stale number —
  // three presses could land one photo along instead of three. This ref is
  // written synchronously by goTo, so N moves always travel N photos.
  const activeRef = useRef(active);

  // Index a programmatic move is scrolling TOWARDS. Smooth scrolling fires
  // onScroll repeatedly on the way, and for the first half of the animation
  // Math.round still reports the OLD index — which would undo the selection we
  // just made and flash the dots backwards. While a move is in flight only the
  // arrival counts; a real pointer gesture clears it, so interrupting a scroll
  // mid-animation can never leave the gallery stuck ignoring its own scroller.
  const pendingRef = useRef<number | null>(null);

  // Exactly one photo is the common case today, and it must not look like a
  // carousel that failed to load. No scroller, no dots, no arrows, no swipe
  // hint and no thumbnail strip — a lone thumbnail under a single photo, or a
  // pair of permanently-disabled arrows, reads as broken rather than as a
  // product that simply has one picture.
  const isSingle = media.length === 1;

  // A video the browser will not play must not leave a black rectangle
  // where a product photo should be. Fall back to the cover — the first
  // PHOTO in the set, which is products.image_url and is kept a photo by
  // the admin form and the product write routes.
  //
  // Keyed on src rather than index so a failing clip and its thumbnail fall
  // back together, and so the set survives a reorder.
  const [failedVideos, setFailedVideos] = useState<string[]>([]);
  const cover = media.find((m) => m.type === "image") ?? null;
  const shown = (m: ProductMedia): ProductMedia =>
    m.type === "video" && cover && failedVideos.includes(m.src) ? cover : m;
  const markVideoFailed = (src: string) =>
    setFailedVideos((f) => (f.includes(src) ? f : [...f, src]));
  // A source that 404s errors while the page is still server-rendered HTML,
  // before hydration has attached onError — so the React handler alone never
  // hears about it and the slide stays a black rectangle. On mount, ask the
  // element directly: NETWORK_NO_SOURCE means it has already tried every
  // source and given up. onError still covers failures after hydration.
  const checkVideoLoaded = (src: string) => (el: HTMLVideoElement | null) => {
    if (el && el.networkState === el.NETWORK_NO_SOURCE) markVideoFailed(src);
  };

  // Display width of the gallery column, used for `sizes`. The shell is
  // maxWidth 1200 with clamp(18px,5vw,64px) padding; from 900px up .pdp-top
  // is a 1.1fr / 1fr grid with a 56px gap, so the image column tops out at
  // (1200 - 128 - 56) * 1.1/2.1 ≈ 532px — NOT the 800px this used to claim.
  // Overstating it makes next/image pick a needlessly large source.
  const sizes = "(max-width: 899px) 92vw, (max-width: 1327px) 45vw, 532px";

  const handleScroll = () => {
    const el = scrollerRef.current;
    // A zero-width scroller divides to Infinity/NaN. That happens in practice
    // before layout settles, and NaN would select nothing while poisoning the
    // ref for every later comparison.
    if (!el || el.clientWidth === 0) return;
    const idx = Math.max(
      0,
      Math.min(media.length - 1, Math.round(el.scrollLeft / el.clientWidth)),
    );
    if (pendingRef.current !== null) {
      if (idx !== pendingRef.current) return; // still mid-flight
      pendingRef.current = null;
    }
    if (idx === activeRef.current) return;
    activeRef.current = idx;
    onSelect(idx);
  };

  const goTo = (i: number) => {
    const next = Math.max(0, Math.min(media.length - 1, i));
    // Select FIRST, then scroll. The dots, the thumbnail highlight, the
    // arrows' disabled state and each slide's aria-hidden all key off `active`
    // — leaving them to be driven by onScroll makes every one of them lag the
    // whole smooth-scroll animation, and if the scroll never happens (reduced
    // motion, a detached or zero-width scroller) they never update at all.
    activeRef.current = next;
    onSelect(next);

    const el = scrollerRef.current;
    if (!el || el.clientWidth === 0) return;
    const left = next * el.clientWidth;
    // Already there: no scroll event is coming, so arming `pending` would
    // block the next genuine swipe forever.
    if (Math.abs(el.scrollLeft - left) < 1) {
      pendingRef.current = null;
      return;
    }
    pendingRef.current = next;
    el.scrollTo({ left, behavior: "smooth" });
  };

  // Relative moves read the ref rather than the `active` prop — see activeRef.
  const step = (delta: number) => goTo(activeRef.current + delta);

  // A touch or mouse press on the photo means the user is taking over from an
  // animation we started; from here their scroll position is the truth.
  const handlePointerDown = () => {
    pendingRef.current = null;
  };

  // Arrow keys move between photos once the scroller has focus. Home/End jump
  // to the ends.
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      goTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      goTo(media.length - 1);
    }
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
          // Only a multi-photo gallery is an interactive widget. A single
          // photo stays a plain image: not focusable, no carousel semantics.
          {...(isSingle
            ? {}
            : {
                tabIndex: 0,
                role: "group",
                "aria-roledescription": "carousel",
                "aria-label": `Product photos, ${media.length} images. Use the left and right arrow keys to browse.`,
                onKeyDown: handleKeyDown,
                onPointerDown: handlePointerDown,
              })}
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
          {media.map((raw, i) => {
            const m = shown(raw);
            return (
            <div
              key={i}
              // Each slide is announced as "3 of 5" rather than as a bare
              // image with no position in the set.
              {...(isSingle
                ? {}
                : {
                    role: "group",
                    "aria-roledescription": "slide",
                    "aria-label": `${i + 1} of ${media.length}`,
                    "aria-hidden": i !== active,
                  })}
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
                // One source, typed from the extension. The pair this
                // replaced derived an ".av1.mp4" sibling and a
                // ".poster.jpg" sibling that admin uploads never have — a
                // 404 round-trip before the real file, and for a .webm or
                // .mov neither replace matched, so BOTH sources became the
                // same URL declared "video/mp4".
                <video
                  ref={checkVideoLoaded(m.src)}
                  autoPlay
                  muted
                  loop
                  playsInline
                  {...(m.poster ? { poster: m.poster } : {})}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    backgroundColor: "#1a1510",
                    display: "block",
                    pointerEvents: "none",
                  }}
                >
                  <source
                    src={m.src}
                    type={videoMimeType(m.src)}
                    onError={() => markVideoFailed(m.src)}
                  />
                </video>
              ) : (
                <Image
                  src={m.src}
                  alt={m.alt || "Product image"}
                  fill
                  draggable={false}
                  sizes={sizes}
                  // First photo is the LCP element — fetch it eagerly. Every
                  // later photo is off-screen until swiped to, so it stays
                  // lazy and costs nothing on first paint.
                  priority={i === 0}
                  loading={i === 0 ? "eager" : "lazy"}
                  style={{
                    objectFit: "cover",
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                />
              )}
            </div>
            );
          })}
        </div>

        {/* Swipe hint — first photo only, and only below 900px. From 900px up
            the desktop arrows are on the photo and telling a mouse user to
            swipe is wrong advice on top of a control that already says it
            better.

            `display: inline-flex` stays INLINE and the media query overrides
            it with !important, rather than the tidier arrangement of putting
            both in the stylesheet. styled-jsx here is injected on hydration —
            none of these .pdp-* rules exist in the SSR HTML or the CSS bundle
            (verified against production) — so a stylesheet-only `display`
            would leave the pill rendering as a full-width block div until the
            JS lands. Inline keeps the server paint correct; !important is what
            lets the query win afterwards. */}
        {media.length > 1 && active === 0 && (
          <div
            className="pdp-swipe-hint"
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

        {/* Desktop arrows. Hidden on touch via CSS (hover/pointer media
            query) because the swipe is the better gesture there and the
            arrows would sit on top of the photo for no reason. Disabled at
            the ends rather than wrapping, so the control always agrees with
            the dots about where you are. */}
        {media.length > 1 && (
          <>
            <button
              type="button"
              className="pdp-arrow pdp-arrow--prev"
              onClick={() => step(-1)}
              disabled={active === 0}
              aria-label="Previous photo"
            >
              <span aria-hidden="true">←</span>
            </button>
            <button
              type="button"
              className="pdp-arrow pdp-arrow--next"
              onClick={() => step(1)}
              disabled={active === media.length - 1}
              aria-label="Next photo"
            >
              <span aria-hidden="true">→</span>
            </button>
          </>
        )}

        {/* Dot indicators. Purely decorative: position is already announced
            by each slide's "n of m" label, so they are hidden from AT. */}
        {media.length > 1 && (
          <div
            aria-hidden="true"
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

      {/* Thumbnail strip — multi-photo only. A single thumbnail under a
          single photo is the "empty carousel chrome" that makes a
          one-image product look like a broken gallery. */}
      {!isSingle && (
      <div
        style={{
          display: "flex",
          gap: 10,
          marginTop: 14,
          overflowX: "auto",
          paddingBottom: 4,
        }}
      >
        {media.map((raw, i) => {
          const m = shown(raw);
          return (
          <button
            key={i}
            type="button"
            onClick={() => goTo(i)}
            aria-current={i === active}
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
              // preload="metadata", not "none": without the derived poster
              // that used to sit here, "none" fetches nothing and the
              // thumbnail is an empty black box. Metadata is enough for the
              // browser to paint the first frame.
              <video
                ref={checkVideoLoaded(m.src)}
                muted
                playsInline
                {...(m.poster ? { poster: m.poster } : {})}
                preload="metadata"
                style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
              >
                <source
                  src={m.src}
                  type={videoMimeType(m.src)}
                  onError={() => markVideoFailed(m.src)}
                />
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
          );
        })}
      </div>
      )}

      <style jsx>{`
        .pdp-scroller::-webkit-scrollbar {
          display: none;
        }
        /* Keyboard focus must be visible on the scroller, but only when
           reached by keyboard — a mouse click on the photo should not draw a
           ring around it. */
        .pdp-scroller:focus-visible {
          outline: 2px solid #024628;
          outline-offset: -2px;
        }
        /* Swipe hint belongs to the narrow layout only. 900px is the same
           breakpoint .pdp-top uses to go two-column, so the hint disappears
           exactly as the gallery becomes the desktop arrangement. */
        @media (min-width: 900px) {
          :global(.pdp-swipe-hint) {
            /* Beats the element's own inline display — see the JSX comment. */
            display: none !important;
          }
        }
        /* Arrows are a POINTER affordance. Touch devices get the swipe, which
           is better, so they never render the overlay at all. */
        :global(.pdp-arrow) {
          display: none;
        }
        @media (hover: hover) and (pointer: fine) {
          :global(.pdp-arrow) {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            border-radius: 999px;
            border: 1px solid #024628;
            background: #fbf3d4;
            color: #024628;
            font-size: 18px;
            line-height: 1;
            cursor: pointer;
            padding: 0;
            opacity: 0.92;
            transition: opacity 0.2s ease, transform 0.2s ease;
          }
          :global(.pdp-arrow:hover:not(:disabled)) {
            opacity: 1;
          }
          :global(.pdp-arrow:disabled) {
            opacity: 0.35;
            cursor: default;
          }
          :global(.pdp-arrow--prev) {
            left: 12px;
          }
          :global(.pdp-arrow--next) {
            right: 12px;
          }
        }
      `}</style>
    </div>
  );
}

// Regulatory label + per-slice nutrition + allergens. Each of the three
// sub-sections renders ONLY when its own field is non-empty, and each
// gets its own divider so a partially-filled row still looks clean. The
// section keys (protein_g etc.) are DB-owned; label, unit and number
// formatting all come from lib/nutrition so the page, the admin form and
// the API agree on what "225 mg" and "< 0.04 g" mean.
// Position of a key on the canonical label; unknown keys sort last (Array
// .sort is stable, so they hold their stored order relative to each other).
function canonicalRank(key: string): number {
  const i = (CANONICAL_NUTRIENT_KEYS as readonly string[]).indexOf(key);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

function LabelInfoSections({
  labelInfo,
  unit,
}: {
  labelInfo: PdpLabelInfo | null;
  // What one row of this table describes, and what it comes in. Passed in
  // rather than assumed: the table used to say "slice" and "loaf" for every
  // product, which is a labelling error on a pack of burger buns, not a
  // wording preference. `undefined` when the slug isn't a known product —
  // the panel then falls back to the unqualified "Values per unit."
  unit?: (typeof PRODUCT_UNIT)[ProductSlug];
}) {
  if (!labelInfo) return null;
  const { ingredients, allergens, nutritionPerSlice, slicesPerLoaf } = labelInfo;
  const ingText = (ingredients ?? "").trim();
  const allergText = (allergens ?? "").trim();
  // A value is renderable when it parses as a number OR as a lower bound
  // ("<0.04"). Anything else is dropped rather than shown as a zero.
  //
  // Rows follow CANONICAL_NUTRIENT_KEYS, not jsonb key order, so the panel
  // reads in the same sequence every time and matches the admin form. jsonb
  // preserves insertion order, which means a value edited in later would
  // otherwise land at the bottom of the label. Non-canonical keys keep their
  // stored order and sort after the known ones.
  const nutriEntries = nutritionPerSlice
    ? Object.entries(nutritionPerSlice)
        .flatMap(([key, v]) => {
          const display = formatNutrient(key, v);
          return display === null ? [] : [[key, display] as const];
        })
        .sort(([a], [b]) => canonicalRank(a) - canonicalRank(b))
    : [];
  if (!ingText && !allergText && nutriEntries.length === 0) return null;

  const one = unit?.unit ?? "unit";
  const nutriSubtitle =
    typeof slicesPerLoaf === "number" && slicesPerLoaf > 0 && unit
      ? `Values per single ${one} (${unit.countIsApprox ? "approx. " : ""}${slicesPerLoaf} ${unit.units} per ${unit.container}).`
      : `Values per single ${one}.`;

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
          <Section label="Nutrition" title={`Per ${one}`}>
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
              {nutriEntries.map(([key, display], i) => {
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
                    <div style={{ ...cellStyle, fontWeight: 400 }}>
                      {nutrientLabel(key)}
                    </div>
                    <div
                      style={{
                        ...cellStyle,
                        textAlign: "right",
                        fontWeight: 500,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {display}
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

