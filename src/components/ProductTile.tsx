"use client";

import Link from "next/link";
import { useState } from "react";
import type { ProductMedia, ProductStat } from "@/lib/data";

type Props = {
  slug: string;
  tag: string;
  title: string;
  subtitle: string;
  price: number;
  stats: ProductStat[];
  media: ProductMedia;
};

export default function ProductTile({ slug, tag, title, subtitle, price, stats, media }: Props) {
  const [hover, setHover] = useState(false);

  return (
    <Link
      href={`/shop/${slug}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
        background: "#0a0805",
        borderRadius: 14,
        border: `1px solid rgba(201, 169, 110, ${hover ? 0.45 : 0.18})`,
        overflow: "hidden",
        transform: hover ? "translateY(-4px)" : "translateY(0)",
        transition: "transform 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease",
        boxShadow: hover ? "0 18px 40px rgba(0,0,0,0.45)" : "0 8px 20px rgba(0,0,0,0.25)",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "4 / 5",
          background: "#1a1510",
          overflow: "hidden",
        }}
      >
        {media.type === "video" ? (
          <video
            src={media.src}
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
            src={media.src}
            alt={media.alt || title}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        )}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(10,8,5,0) 55%, rgba(10,8,5,0.65) 100%)",
            pointerEvents: "none",
          }}
        />
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
          }}
        >
          <span>Test Reports</span>
          <span aria-hidden="true" style={{ fontSize: 10, lineHeight: 1 }}>✓</span>
        </div>
      </div>

      <div style={{ padding: "18px 20px 20px" }}>
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
          style={{
            margin: 0,
            fontFamily: "var(--font-heading)",
            fontSize: 28,
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
  );
}
