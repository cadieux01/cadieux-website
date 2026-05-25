"use client";

import Link from "next/link";
import Image from "next/image";
import { notFound, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  PRODUCTS,
  PRODUCT_DETAILS,
  type ProductSlug,
  type ProductMedia,
} from "@/lib/data";
import { useCart } from "@/context/CartContext";
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
  background: "rgba(201, 169, 110, 0.15)",
  margin: "48px 0",
  border: 0,
};

export default function ProductDetailClient({
  slug,
  outOfStock = false,
  reports = [],
}: {
  slug: string;
  outOfStock?: boolean;
  reports?: ProductReport[];
}) {
  const typedSlug = slug as ProductSlug;
  const product = PRODUCTS.find((p) => p.slug === typedSlug);
  const detail = product ? PRODUCT_DETAILS[typedSlug] : undefined;

  const [activeMedia, setActiveMedia] = useState(0);
  const [orderType, setOrderType] = useState<"once" | "sub">("once");
  const [added, setAdded] = useState(false);
  const { addToCart } = useCart();
  const router = useRouter();
  const addBtnRef = useRef<HTMLButtonElement>(null);

  if (!product || !detail) {
    notFound();
  }

  const productIndex = PRODUCTS.findIndex((p) => p.slug === typedSlug);

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
      name: product.name,
      price: product.price,
      qty: 1,
      orderType,
    });
    flyToCart(addBtnRef.current);
    setAdded(true);
    setTimeout(() => setAdded(false), 1600);
  };

  return (
    <div style={{ minHeight: "100dvh", background: "#1D1D1F", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />

      <Link
        href="/shop"
        style={{
          position: "fixed",
          top: "calc(24px + env(safe-area-inset-top))",
          left: "calc(20px + env(safe-area-inset-left))",
          zIndex: 101,
          fontFamily: "var(--font-body)",
          fontSize: 10,
          fontWeight: 200,
          letterSpacing: "0.35em",
          textTransform: "uppercase",
          color: "#4369B2",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 14 }}>←</span> Our Breads
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
          <Gallery media={detail.media} active={activeMedia} onSelect={setActiveMedia} />

          <div style={{ minWidth: 0 }}>
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
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: "0.35em",
                  textTransform: "uppercase",
                  color: "#c9a96e",
                }}
              >
                {product.tag}
              </div>
              <ShareButton
                title={`${product.title} — Cadieux`}
                text={`${product.title}. ${product.subtitle}`}
                url={`https://www.cadieux.in/shop/${product.slug}`}
                size={36}
              />
            </div>
            <h1
              style={{
                margin: 0,
                fontFamily: "var(--font-heading)",
                fontSize: "clamp(40px, 7vw, 64px)",
                fontWeight: 300,
                color: "#FBF3D4",
                lineHeight: 1.05,
                letterSpacing: "0.01em",
              }}
            >
              {product.title}
            </h1>
            <p
              style={{
                margin: "18px 0 28px",
                fontFamily: "var(--font-body)",
                fontSize: 14,
                lineHeight: 1.65,
                fontWeight: 300,
                color: "rgba(251, 243, 212, 0.7)",
                maxWidth: 460,
              }}
            >
              {product.subtitle}
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 12,
                padding: "18px 0",
                borderTop: "0.5px solid rgba(201,169,110,0.2)",
                borderBottom: "0.5px solid rgba(201,169,110,0.2)",
                marginBottom: 32,
              }}
            >
              {product.stats.map((s) => (
                <div key={s.label}>
                  <div
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontSize: 26,
                      fontWeight: 500,
                      color: "#c9a96e",
                      lineHeight: 1,
                    }}
                  >
                    {s.target}
                    {s.suffix}
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontFamily: "var(--font-body)",
                      fontSize: 9,
                      fontWeight: 300,
                      letterSpacing: "0.22em",
                      textTransform: "uppercase",
                      color: "rgba(245,240,232,0.55)",
                    }}
                  >
                    {s.label}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 20 }}>
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 42,
                  fontWeight: 500,
                  color: "#FBF3D4",
                  lineHeight: 1,
                }}
              >
                ₹{product.price}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 11,
                  fontWeight: 300,
                  color: "rgba(245,240,232,0.5)",
                }}
              >
                {orderType === "sub" ? "per delivery" : "one-time"}
              </div>
            </div>

            {/* Order type toggle */}
            <div
              style={{
                display: "inline-flex",
                padding: 4,
                borderRadius: 999,
                border: "1px solid rgba(201,169,110,0.3)",
                background: "rgba(10,8,5,0.35)",
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
                    background: orderType === type ? "rgba(201,169,110,0.2)" : "transparent",
                    color: orderType === type ? "#FBF3D4" : "rgba(245,240,232,0.55)",
                    fontFamily: "var(--font-body)",
                    fontSize: 10,
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
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: "0.25em",
                  textTransform: "uppercase",
                  color: "#fecaca",
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.45)",
                  borderRadius: 4,
                }}
              >
                Currently out of stock — please check back soon.
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
                  background: added ? "rgba(201,169,110,0.25)" : "transparent",
                  border: `1px solid ${outOfStock ? "rgba(201,169,110,0.3)" : "#c9a96e"}`,
                  color: outOfStock ? "rgba(245,240,232,0.45)" : "#FBF3D4",
                  fontFamily: "var(--font-body)",
                  fontSize: 11,
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
              {detail.description.map((para, i) => (
                <p
                  key={i}
                  style={{
                    margin: "0 0 14px",
                    fontFamily: "var(--font-body)",
                    fontSize: 13,
                    lineHeight: 1.75,
                    fontWeight: 300,
                    color: "rgba(251, 243, 212, 0.7)",
                  }}
                >
                  {para}
                </p>
              ))}
            </div>
          </div>
        </div>

        <hr style={DIVIDER_STYLE} />

        {/* Ingredients */}
        <Section label="Inside the loaf" title="Ingredients">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 20,
            }}
          >
            {detail.ingredients.map((ing) => (
              <div
                key={ing.name}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 14,
                  padding: "18px 18px",
                  background: "rgba(10,8,5,0.35)",
                  border: "0.5px solid rgba(201,169,110,0.15)",
                  borderRadius: 8,
                }}
              >
                <span
                  style={{
                    flex: "0 0 8px",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#c9a96e",
                    marginTop: 8,
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontSize: 18,
                      color: "#FBF3D4",
                      lineHeight: 1.2,
                      marginBottom: 4,
                    }}
                  >
                    {ing.name}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: 12,
                      lineHeight: 1.55,
                      fontWeight: 300,
                      color: "rgba(245,240,232,0.55)",
                    }}
                  >
                    {ing.role}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {reports.length > 0 ? (
          <>
            <hr style={DIVIDER_STYLE} />
            <Section label="Independently tested" title="Lab Reports & Certifications">
              <ReportsList reports={reports} />
            </Section>
            <hr style={DIVIDER_STYLE} />
          </>
        ) : (
          <hr style={DIVIDER_STYLE} />
        )}

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
          border: "0.5px solid rgba(201,169,110,0.18)",
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

        {/* Swipe hint — only on first item */}
        {media.length > 1 && active === 0 && (
          <div
            style={{
              position: "absolute",
              top: 14,
              left: 14,
              fontFamily: "var(--font-body)",
              fontSize: 9,
              fontWeight: 500,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "rgba(245,240,232,0.75)",
              padding: "6px 12px",
              background: "rgba(10,8,5,0.6)",
              border: "0.5px solid rgba(245,240,232,0.22)",
              borderRadius: 4,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              backdropFilter: "blur(4px)",
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
                  background: i === active ? "#c9a96e" : "rgba(245,240,232,0.45)",
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
              border: `1.5px solid ${i === active ? "#c9a96e" : "rgba(201,169,110,0.2)"}`,
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

function Section({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <div
        style={{
          fontFamily: "var(--font-body)",
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.4em",
          textTransform: "uppercase",
          color: "#c9a96e",
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
          color: "#FBF3D4",
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
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: "#c9a96e",
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
                    border: "1px solid rgba(201, 169, 110, 0.35)",
                    background: "rgba(201,169,110,0.05)",
                    textDecoration: "none",
                    color: "#FBF3D4",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: 14,
                      fontWeight: 500,
                      letterSpacing: "0.02em",
                      marginBottom: 6,
                    }}
                  >
                    {r.title}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: 11,
                      letterSpacing: "0.2em",
                      textTransform: "uppercase",
                      color: "#c9a96e",
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

