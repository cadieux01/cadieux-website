// Offline fallback. Served by the service worker when a navigation request
// fails (no network, server unreachable). Pure HTML/CSS — no client JS, no
// fetches. Mirrors the walnut + cream palette used across the site so the
// experience still feels like Cadieux.

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Offline | Cadieux",
  description: "You're offline. Reconnect to keep browsing Cadieux.",
};

const BG = "rgb(6,4,2)";
const TEXT = "#FBF3D4";
const GOLD = "#c9a96e";

export default function OfflinePage() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: BG,
        color: TEXT,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 24px",
        textAlign: "center",
        fontFamily: "var(--font-body)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.4em",
          textTransform: "uppercase",
          color: "rgba(201,169,110,0.7)",
          marginBottom: 24,
        }}
      >
        Cadieux
      </div>

      <h1
        style={{
          margin: 0,
          fontFamily: "var(--font-heading)",
          fontSize: "clamp(40px, 9vw, 72px)",
          fontWeight: 300,
          letterSpacing: "0.02em",
          lineHeight: 1,
        }}
      >
        You&rsquo;re offline.
      </h1>

      <p
        style={{
          margin: "20px 0 32px",
          maxWidth: 420,
          fontSize: 14,
          fontWeight: 300,
          lineHeight: 1.6,
          color: "rgba(251,243,212,0.7)",
        }}
      >
        The bread is still rising. Check your connection and we&rsquo;ll
        bring you back to where you left off.
      </p>

      <Link
        href="/"
        style={{
          fontSize: 11,
          letterSpacing: "0.35em",
          textTransform: "uppercase",
          color: GOLD,
          textDecoration: "none",
          padding: "12px 28px",
          border: "1px solid rgba(201,169,110,0.4)",
          borderRadius: 3,
        }}
      >
        Try again
      </Link>
    </div>
  );
}
