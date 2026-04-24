"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  PRODUCTS,
  PRODUCT_DETAILS,
  type ProductSlug,
  type ProductMedia,
  type ProductReview,
} from "@/lib/data";
import { useCart } from "@/context/CartContext";

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const DIVIDER_STYLE: React.CSSProperties = {
  height: 1,
  background: "rgba(201, 169, 110, 0.15)",
  margin: "72px 0",
  border: 0,
};

export default function ProductDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug as ProductSlug | undefined;
  const product = slug ? PRODUCTS.find((p) => p.slug === slug) : undefined;
  const detail = slug && product ? PRODUCT_DETAILS[slug] : undefined;

  const [activeMedia, setActiveMedia] = useState(0);
  const [orderType, setOrderType] = useState<"once" | "sub">("once");
  const [added, setAdded] = useState(false);
  const { addToCart } = useCart();

  const avgRating = useMemo(() => {
    if (!detail) return 0;
    const sum = detail.reviews.reduce((a, r) => a + r.rating, 0);
    return sum / detail.reviews.length;
  }, [detail]);

  if (!slug || !product || !detail) {
    notFound();
  }

  const productIndex = PRODUCTS.findIndex((p) => p.slug === slug);
  const media = detail.media[activeMedia] ?? detail.media[0];

  const handleAdd = () => {
    addToCart({
      productIndex,
      name: product.name,
      price: product.price,
      qty: 1,
      orderType,
    });
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
          top: 24,
          left: 20,
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
          padding: "96px clamp(20px,5vw,64px) 140px",
          maxWidth: 1200,
          margin: "0 auto",
        }}
      >
        {/* Top fold: gallery + info */}
        <div className="pdp-top">
          <Gallery media={detail.media} active={activeMedia} onSelect={setActiveMedia} current={media} />

          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: "0.35em",
                textTransform: "uppercase",
                color: "#c9a96e",
                marginBottom: 14,
              }}
            >
              {product.tag}
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

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button
                onClick={handleAdd}
                style={{
                  flex: "1 1 220px",
                  padding: "16px 26px",
                  background: added ? "rgba(201,169,110,0.25)" : "transparent",
                  border: "1px solid #c9a96e",
                  color: "#FBF3D4",
                  fontFamily: "var(--font-body)",
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: "0.35em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  borderRadius: 4,
                  transition: "background 0.3s ease",
                }}
              >
                {added ? "Added ✓" : "Add to Cart"}
              </button>
              <Link
                href="/cart"
                style={{
                  flex: "0 0 auto",
                  padding: "16px 26px",
                  background: "rgba(201,169,110,0.08)",
                  border: "1px solid rgba(201,169,110,0.3)",
                  color: "rgba(245,240,232,0.7)",
                  fontFamily: "var(--font-body)",
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: "0.35em",
                  textTransform: "uppercase",
                  borderRadius: 4,
                  textDecoration: "none",
                  textAlign: "center",
                }}
              >
                View Cart
              </Link>
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

        <hr style={DIVIDER_STYLE} />

        {/* Test reports */}
        <Section label="Independently tested" title="Test Reports">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 18,
            }}
          >
            {detail.testReports.map((r) => (
              <div
                key={r.metric}
                style={{
                  padding: "26px 22px",
                  background: "rgba(10,8,5,0.45)",
                  border: "0.5px solid rgba(201,169,110,0.22)",
                  borderRadius: 10,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 9,
                    fontWeight: 500,
                    letterSpacing: "0.3em",
                    textTransform: "uppercase",
                    color: "rgba(201,169,110,0.7)",
                    marginBottom: 14,
                  }}
                >
                  {r.metric}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 38,
                    fontWeight: 500,
                    color: "#FBF3D4",
                    lineHeight: 1,
                    marginBottom: 12,
                  }}
                >
                  {r.value}
                </div>
                {r.note && (
                  <div
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: 11,
                      fontWeight: 300,
                      color: "rgba(245,240,232,0.45)",
                      lineHeight: 1.5,
                    }}
                  >
                    {r.note}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>

        <hr style={DIVIDER_STYLE} />

        {/* Reviews */}
        <Section label="What customers say" title="Customer Reviews">
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32, flexWrap: "wrap" }}>
            <Stars rating={avgRating} size={18} />
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 22,
                color: "#FBF3D4",
                fontWeight: 500,
              }}
            >
              {avgRating.toFixed(1)}
            </div>
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 11,
                fontWeight: 300,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "rgba(245,240,232,0.5)",
              }}
            >
              {detail.reviews.length} verified reviews
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {detail.reviews.map((rev, i) => (
              <ReviewRow key={i} review={rev} />
            ))}
          </div>
        </Section>
      </div>

      <style jsx>{`
        .pdp-top {
          display: grid;
          grid-template-columns: 1fr;
          gap: 40px;
          align-items: start;
        }
        @media (min-width: 900px) {
          .pdp-top {
            grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
            gap: 56px;
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
  current,
}: {
  media: ProductMedia[];
  active: number;
  onSelect: (i: number) => void;
  current: ProductMedia;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "4 / 5",
          background: "#1a1510",
          borderRadius: 14,
          overflow: "hidden",
          border: "0.5px solid rgba(201,169,110,0.18)",
        }}
      >
        {current.type === "video" ? (
          <video
            key={current.src}
            src={current.src}
            autoPlay
            muted
            loop
            playsInline
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              backgroundColor: "#1a1510",
            }}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={current.src}
            src={current.src}
            alt={current.alt || "Product image"}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
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
            onClick={() => onSelect(i)}
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
                src={m.src}
                muted
                playsInline
                style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={m.src}
                alt={m.alt || ""}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            )}
          </button>
        ))}
      </div>
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

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <div style={{ display: "inline-flex", gap: 2, color: "#c9a96e", fontSize: size, lineHeight: 1 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} style={{ opacity: rating >= i + 1 ? 1 : rating >= i + 0.5 ? 0.7 : 0.25 }}>
          ★
        </span>
      ))}
    </div>
  );
}

function ReviewRow({ review }: { review: ProductReview }) {
  return (
    <div
      style={{
        padding: "22px 22px",
        background: "rgba(10,8,5,0.4)",
        border: "0.5px solid rgba(201,169,110,0.14)",
        borderRadius: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 17,
              fontWeight: 500,
              color: "#FBF3D4",
            }}
          >
            {review.name}
          </div>
          <Stars rating={review.rating} />
        </div>
        <div
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 10,
            fontWeight: 300,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "rgba(245,240,232,0.4)",
          }}
        >
          {review.date}
        </div>
      </div>
      <p
        style={{
          margin: 0,
          fontFamily: "var(--font-body)",
          fontSize: 13,
          lineHeight: 1.7,
          fontWeight: 300,
          color: "rgba(251, 243, 212, 0.72)",
        }}
      >
        {review.body}
      </p>
    </div>
  );
}
