import Link from "next/link";

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export default function StoreLocatorPage() {
  return (
    <div style={{ minHeight: "100dvh", background: "rgb(6,4,2)", position: "relative", overflowX: "clip" }}>
      {/* Grain overlay */}
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />

      {/* Back arrow */}
      <Link href="/" style={{
        position: "fixed", top: 24, left: 28, zIndex: 101,
        fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200,
        letterSpacing: "0.3em", textTransform: "uppercase",
        color: "rgb(200,144,58)", textDecoration: "none",
      }}>← Cadieux</Link>

      {/* Content */}
      <div style={{
        position: "relative", zIndex: 1,
        minHeight: "100dvh", display: "flex", flexDirection: "column",
        justifyContent: "center", padding: "120px clamp(28px, 8vw, 120px) 80px",
      }}>
        <h1 style={{
          margin: "0 0 64px",
          fontFamily: "var(--font-heading)",
          fontSize: "clamp(52px, 12vw, 96px)",
          fontWeight: 300, color: "rgb(240,223,200)",
          letterSpacing: "0.02em", lineHeight: 1,
        }}>Find Us</h1>

        <p style={{
          margin: "0 0 48px",
          fontFamily: "var(--font-body)", fontSize: 9,
          fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase",
          color: "rgba(200,144,58,0.5)",
        }}>Coming Soon — Stocking Locations Near You</p>
      </div>
    </div>
  );
}
