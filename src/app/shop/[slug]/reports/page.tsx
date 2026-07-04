"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { PRODUCTS, type ProductSlug } from "@/lib/data";
import { ShareButton } from "@/components/ShareButton";

const GRAIN = "url(/grain.svg)";

export default function ProductReportsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug as ProductSlug | undefined;
  const product = slug ? PRODUCTS.find((p) => p.slug === slug) : undefined;

  if (!slug || !product) {
    notFound();
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#1D1D1F", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />

      <Link
        href={`/shop/${slug}`}
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
        <span style={{ fontSize: 14 }}>←</span> Back to {product.title}
      </Link>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "96px clamp(20px,6vw,64px) 80px",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 620,
            textAlign: "center",
            padding: "clamp(32px,6vw,56px) clamp(24px,5vw,48px)",
            background: "rgba(10,8,5,0.55)",
            border: "0.5px solid rgba(201,169,110,0.25)",
            borderRadius: 16,
            backdropFilter: "blur(6px)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: "#024628",
              marginBottom: 18,
            }}
          >
            {product.tag} · {product.title}
          </div>

          <h1
            style={{
              margin: "0 0 20px",
              fontFamily: "var(--font-heading)",
              fontSize: "clamp(34px, 6vw, 52px)",
              fontWeight: 300,
              color: "#FBF3D4",
              lineHeight: 1.1,
              letterSpacing: "0.01em",
            }}
          >
            Test Reports
          </h1>

          <p
            style={{
              margin: "0 0 20px",
              fontFamily: "var(--font-body)",
              fontSize: 13,
              fontWeight: 300,
              letterSpacing: "0.04em",
              color: "#024628",
            }}
          >
            Final trials are under process.
          </p>

          <div
            aria-hidden="true"
            style={{
              width: 56,
              height: 56,
              margin: "8px auto 24px",
              borderRadius: "50%",
              border: "1.5px solid rgba(201,169,110,0.35)",
              borderTopColor: "#024628",
              animation: "reports-spin 1.4s linear infinite",
            }}
          />

          <p
            style={{
              margin: "0 0 14px",
              fontFamily: "var(--font-heading)",
              fontSize: "clamp(20px, 3vw, 26px)",
              fontWeight: 400,
              color: "#FBF3D4",
              lineHeight: 1.4,
            }}
          >
            Our reports are being re-verified.
          </p>

          <p
            style={{
              margin: "0 0 10px",
              fontFamily: "var(--font-body)",
              fontSize: 14,
              lineHeight: 1.75,
              fontWeight: 300,
              color: "rgba(251, 243, 212, 0.65)",
            }}
          >
            We&rsquo;ll be back with the latest reports as soon as possible.
          </p>

          <p
            style={{
              margin: "22px 0 0",
              fontFamily: "var(--font-body)",
              fontSize: 11,
              fontWeight: 400,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "#024628",
            }}
          >
            Thank you for trusting Cadieux.
          </p>

          <div
            style={{
              marginTop: 34,
              display: "flex",
              justifyContent: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <ShareButton
              title={`${product.title} — Test Reports`}
              text={`${product.title}: independent lab reports from Cadieux.`}
              url={`https://www.cadieux.in/shop/${slug}/reports`}
              label="Share"
              size={42}
            />
            <Link
              href={`/shop/${slug}`}
              style={{
                padding: "14px 26px",
                border: "1px solid #024628",
                color: "#FBF3D4",
                fontFamily: "var(--font-body)",
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: "0.35em",
                textTransform: "uppercase",
                borderRadius: 4,
                textDecoration: "none",
              }}
            >
              Back to Product
            </Link>
            <Link
              href="/shop"
              style={{
                padding: "14px 26px",
                background: "rgba(201,169,110,0.08)",
                border: "1px solid rgba(201,169,110,0.3)",
                color: "rgba(245,240,232,0.7)",
                fontFamily: "var(--font-body)",
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: "0.35em",
                textTransform: "uppercase",
                borderRadius: 4,
                textDecoration: "none",
              }}
            >
              Our Breads
            </Link>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes reports-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
