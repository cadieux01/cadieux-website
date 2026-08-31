import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Contact Cadieux — Protein Bread from Visakhapatnam",
  description:
    "Reach the Cadieux team on WhatsApp, Instagram, email, or phone. We reply personally to every message from our Visakhapatnam kitchen.",
  alternates: { canonical: "/connect" },
};

const GRAIN = "url(/grain.svg)";

const CONTACTS = [
  { label: "Instagram", value: "@cadieuxindia",    href: "https://instagram.com/cadieuxindia" },
  { label: "WhatsApp",  value: "+91 99891 53747",  href: "https://wa.me/919989153747" },
  { label: "Email",     value: "admin@cadieux.in", href: "mailto:admin@cadieux.in" },
  { label: "Phone",     value: "+91 99891 53747",  href: "tel:+919989153747" },
];

export default function ConnectPage() {
  return (
    <div style={{ minHeight: "100dvh", background: "#C0C8CE", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.04, mixBlendMode: "multiply", pointerEvents: "none", zIndex: 0 }} />

      <Link href="/" style={{
        position: "fixed", top: "calc(24px + env(safe-area-inset-top))", left: "calc(20px + env(safe-area-inset-left))", zIndex: 101,
        fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
        letterSpacing: "0.35em", textTransform: "uppercase",
        color: "#024628", textDecoration: "none",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>←</span> Cadieux
      </Link>

      <div style={{ position: "relative", zIndex: 1, padding: "100px clamp(24px,6vw,80px) 120px", maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 12px", fontFamily: "var(--font-heading)", fontSize: "clamp(48px,11vw,88px)", fontWeight: 300, color: "#024628", letterSpacing: "0.02em", lineHeight: 1 }}>
          Connect
        </h1>
        <p style={{ margin: "0 0 36px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(2,70,40,0.7)" }}>
          Talk to us
        </p>

        {CONTACTS.map(({ label, value, href }) => (
          <a key={label} href={href} target="_blank" rel="noopener noreferrer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0", borderBottom: "1px solid rgba(2,70,40,0.2)", textDecoration: "none" }}>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(2,70,40,0.75)" }}>{label}</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 300, color: "#024628", letterSpacing: "0.04em" }}>{value}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
