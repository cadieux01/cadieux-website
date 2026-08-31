"use client";

import Link from "next/link";

export default function ShopCTA() {
  return (
    <div
      style={{
        marginTop: "64px",
        paddingTop: "48px",
        borderTop: "1px solid rgba(2,70,40,0.2)",
      }}
    >
      <p
        style={{
          margin: "0 0 16px",
          fontFamily: "var(--font-body)",
          fontSize: 14,
          fontWeight: 500,
          color: "rgba(2,70,40,0.75)",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}
      >
        Ready to try Cadieux?
      </p>
      <Link
        href="/shop"
        style={{
          display: "inline-block",
          padding: "12px 24px",
          fontFamily: "var(--font-body)",
          fontSize: 16,
          fontWeight: 400,
          color: "#FBF3D4",
          background: "#024628",
          border: "1px solid #024628",
          textDecoration: "none",
          transition: "all 200ms ease",
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLAnchorElement;
          el.style.background = "#013620";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLAnchorElement;
          el.style.background = "#024628";
        }}
      >
        Explore our bread →
      </Link>
    </div>
  );
}
