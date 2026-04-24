"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { ProductMedia, ProductStat } from "@/lib/data";

type Props = {
  slug: string;
  tag: string;
  title: string;
  subtitle: string;
  price: number;
  stats: ProductStat[];
  media: ProductMedia[];
};

export default function ProductTile({ slug, tag, title, subtitle, price, stats, media }: Props) {
  const [hover, setHover] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const handleScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx !== activeIdx) setActiveIdx(idx);
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: "#0a0805",
        borderRadius: 14,
        border: `1px solid rgba(201, 169, 110, ${hover ? 0.45 : 0.18})`,
        overflow: "hidden",
        transform: hover ? "translateY(-4px)" : "translateY(0)",
        transition: "transform 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease",
        boxShadow: hover ? "0 18px 40px rgba(0,0,0,0.45)" : "0 8px 20px rgba(0,0,0,0.25)",
      }}
    >
      {/* Swipeable media gallery (NOT inside Link — users can freely swipe without triggering navigation) */}
      <div className="tile-media" style={{ position: "relative", width: "100%", background: "#1a1510" }}>
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="tile-scroller"
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
                  src={m.src}
                  autoPlay
                  muted
                  loop
                  playsInline
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    backgroundColor: "#1a1510",
                    display: "block",
                    pointerEvents: "none",
                  }}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={m.src}
                  alt={m.alt || title}
                  draggable={false}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* gradient overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(10,8,5,0) 55%, rgba(10,8,5,0.65) 100%)",
            pointerEvents: "none",
          }}
        />

        {/* Test Reports badge */}
        <div
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            fontFamily: "var(--font-body)",
            fontSize: 9,
            fontWeight: 500,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#c9a96e",
            padding: "5px 10px",
            background: "rgba(10,8,5,0.7)",
            border: "0.5px solid rgba(201,169,110,0.4)",
            borderRadius: 4,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            backdropFilter: "blur(4px)",
            pointerEvents: "none",
          }}
        >
          <span>Test Reports</span>
          <span aria-hidden="true" style={{ fontSize: 10, lineHeight: 1 }}>✓</span>
        </div>

        {/* "Swipe" hint — only when more than one media */}
        {media.length > 1 && activeIdx === 0 && (
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              fontFamily: "var(--font-body)",
              fontSize: 8,
              fontWeight: 500,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "rgba(245,240,232,0.7)",
              padding: "5px 10px",
              background: "rgba(10,8,5,0.55)",
              border: "0.5px solid rgba(245,240,232,0.2)",
              borderRadius: 4,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
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
              bottom: 10,
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
                  width: i === activeIdx ? 18 : 6,
                  height: 6,
                  borderRadius: 999,
                  background: i === activeIdx ? "#c9a96e" : "rgba(245,240,232,0.45)",
                  transition: "all 0.25s ease",
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Info — wrapped in Link so tap/click navigates to PDP */}
      <Link
        href={`/shop/${slug}`}
        style={{
          display: "block",
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <div className="tile-body">
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 9,
              fontWeight: 500,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "#c9a96e",
              marginBottom: 8,
            }}
          >
            {tag}
          </div>
          <h3
            className="tile-title"
            style={{
              margin: 0,
              fontFamily: "var(--font-heading)",
              fontWeight: 400,
              color: "#f5f0e8",
              letterSpacing: "0.01em",
              lineHeight: 1.05,
            }}
          >
            {title}
          </h3>
          <p
            style={{
              margin: "10px 0 14px",
              fontFamily: "var(--font-body)",
              fontSize: 12,
              lineHeight: 1.5,
              fontWeight: 300,
              color: "rgba(245,240,232,0.55)",
            }}
          >
            {subtitle}
          </p>

          <div
            style={{
              display: "flex",
              gap: 14,
              paddingTop: 12,
              borderTop: "0.5px solid rgba(201,169,110,0.18)",
              marginBottom: 16,
            }}
          >
            {stats.map((s) => (
              <div key={s.label} style={{ flex: 1, textAlign: "left" }}>
                <div
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 20,
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
                    marginTop: 4,
                    fontFamily: "var(--font-body)",
                    fontSize: 8,
                    fontWeight: 300,
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    color: "rgba(245,240,232,0.45)",
                  }}
                >
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 28,
                fontWeight: 500,
                color: "#f5f0e8",
                lineHeight: 1,
              }}
            >
              ₹{price}
            </div>
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: "0.35em",
                textTransform: "uppercase",
                color: hover ? "#f5f0e8" : "#c9a96e",
                padding: "10px 16px",
                border: `1px solid ${hover ? "#c9a96e" : "rgba(201,169,110,0.5)"}`,
                borderRadius: 999,
                background: hover ? "rgba(201,169,110,0.15)" : "transparent",
                transition: "all 0.3s ease",
              }}
            >
              View →
            </div>
          </div>
        </div>
      </Link>

      <style jsx>{`
        .tile-media {
          aspect-ratio: 16 / 11;
        }
        .tile-body {
          padding: 16px 16px 18px;
        }
        .tile-title {
          font-size: 22px;
        }
        .tile-scroller::-webkit-scrollbar {
          display: none;
        }
        @media (min-width: 640px) {
          .tile-media {
            aspect-ratio: 4 / 5;
          }
          .tile-body {
            padding: 18px 20px 20px;
          }
          .tile-title {
            font-size: 28px;
          }
        }
      `}</style>
    </div>
  );
}
