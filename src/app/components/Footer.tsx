"use client";

import Link from "next/link";
import SplitText from "@/components/SplitTextLazy";

export default function Footer() {
  return (
    <footer
      style={{
        borderTop: "1px solid rgba(192,200,206,0.15)",
        padding: "3rem 2rem",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1rem",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: "clamp(1.5rem, 3vw, 2.4rem)",
          fontWeight: 300,
          color: "#fbf3d4",
          letterSpacing: "0.15em",
        }}
      >
        <SplitText text="CADIEUX" repelStrength={55} repelRadius={110} staggerDelay={0.05} />
      </div>
      <p className="label-text" style={{ opacity: 0.6 }}>
        <SplitText text="Same Bread. Better Built." repelStrength={30} repelRadius={85} staggerDelay={0.025} />
      </p>
      <nav
        aria-label="Footer"
        style={{
          display: "flex",
          gap: "1.5rem",
          flexWrap: "wrap",
          justifyContent: "center",
          marginTop: "0.5rem",
        }}
      >
        <Link
          href="/find-us"
          className="label-text"
          style={{
            color: "#FBF3D4",
            textDecoration: "none",
            opacity: 0.85,
          }}
        >
          Store Locator
        </Link>
      </nav>
      <p className="label-text" style={{ opacity: 0.4, marginTop: "1rem" }}>
        <SplitText text="© 2024 CADIEUX · VISAKHAPATNAM" repelStrength={20} repelRadius={70} staggerDelay={0.02} animateEntrance={false} />
      </p>
    </footer>
  );
}
