"use client";

import Link from "next/link";

export default function ShopCTA() {
  return (
    <div
      style={{
        marginTop: "64px",
        paddingTop: "48px",
        borderTop: "1px solid rgba(240,223,200,0.1)",
      }}
    >
      <p
        style={{
          margin: "0 0 16px",
          fontFamily: "var(--font-body)",
          fontSize: 12,
          fontWeight: 200,
          color: "rgba(251,243,212,0.6)",
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
          fontSize: 13,
          fontWeight: 300,
          color: "#FBF3D4",
          border: "1px solid rgba(251,243,212,0.4)",
          textDecoration: "none",
          transition: "all 200ms ease",
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLAnchorElement;
          el.style.background = "rgba(251,243,212,0.1)";
          el.style.borderColor = "rgba(251,243,212,0.8)";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLAnchorElement;
          el.style.background = "transparent";
          el.style.borderColor = "rgba(251,243,212,0.4)";
        }}
      >
        Explore our bread →
      </Link>
    </div>
  );
}
