"use client";

// Subscription hub. Three smart cards:
//   1. Start New Plan  — always visible
//   2. Track Plans     — only when active count > 0
//   3. Past Plans      — only when completed/cancelled count > 0
//
// Counts come from the existing /api/subscriptions and /api/subscriptions/past
// endpoints, both keyed by the phone we already cache in localStorage at OTP
// time. If the user has never verified a phone on this device, we just render
// the "Start New Plan" card — same as a cold visitor.

import { useEffect, useState } from "react";
import Link from "next/link";

const BG = "rgb(6,4,2)";
const WALNUT = "#1a2e1a";
const GOLD = "#c9a96e";
const CREAM = "#f5f0e8";
const TEXT = "#FBF3D4";

const GRAIN =
  "url(/grain.svg)";

type Card = {
  href: string;
  title: string;
  caption: string;
  icon: React.ReactNode;
};

function readPhone(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("cadieux_phone") ?? "";
}

// Tiny inline SVG icons — single-stroke, gold, no external deps.
function IconBread() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 11c0-3 2-5 5-5h6c3 0 5 2 5 5 0 1.5-.8 2.5-2 3v3a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-3c-1.2-.5-2-1.5-2-3z" />
      <path d="M9 12v4M12 12v4M15 12v4" opacity="0.55" />
    </svg>
  );
}
function IconList() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h10" />
      <circle cx="20" cy="18" r="1.4" fill={GOLD} stroke="none" opacity="0.7" />
    </svg>
  );
}
function IconArchive() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 13h4" />
    </svg>
  );
}

export default function SubscriptionHubPage() {
  const [activeCount, setActiveCount] = useState(0);
  const [pastCount, setPastCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const phone = readPhone();
    if (!phone) return; // cold visitor — only "Start New Plan" renders
    (async () => {
      try {
        const [aRes, pRes] = await Promise.all([
          fetch(`/api/subscriptions?phone=${encodeURIComponent(phone)}`, { cache: "no-store" }),
          fetch(`/api/subscriptions/past?phone=${encodeURIComponent(phone)}`, { cache: "no-store" }),
        ]);
        const aJ = await aRes.json().catch(() => ({}));
        const pJ = await pRes.json().catch(() => ({}));
        if (cancelled) return;
        setActiveCount(Array.isArray(aJ.subscriptions) ? aJ.subscriptions.length : 0);
        setPastCount(Array.isArray(pJ.subscriptions) ? pJ.subscriptions.length : 0);
      } catch {
        /* fall through — render Start-only */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cards: Card[] = [
    {
      href: "/subscriptions/setup",
      title: "Start New Plan",
      caption: "Pick days, pick slots, set it and forget it.",
      icon: <IconBread />,
    },
  ];
  if (activeCount > 0) {
    cards.push({
      href: "/subscriptions/track",
      title: "Track Plans",
      caption:
        activeCount === 1
          ? "1 active plan — see upcoming deliveries."
          : `${activeCount} active plans — see upcoming deliveries.`,
      icon: <IconList />,
    });
  }
  if (pastCount > 0) {
    cards.push({
      href: "/subscriptions/past",
      title: "Past Plans",
      // pastCount now includes active + completed + cancelled — it's the
      // full history. The wording reflects that.
      caption:
        pastCount === 1
          ? "1 plan in your history."
          : `${pastCount} plans in your history.`,
      icon: <IconArchive />,
    });
  }

  return (
    <div style={{ minHeight: "100dvh", background: BG, position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />

      <Link
        href="/"
        style={{
          position: "fixed", top: 24, left: 20, zIndex: 101,
          fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
          letterSpacing: "0.35em", textTransform: "uppercase",
          color: "#4369B2", textDecoration: "none",
          display: "flex", alignItems: "center", gap: 8,
        }}
      >
        <span style={{ fontSize: 14 }}>←</span> Cadieux
      </Link>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "100px clamp(24px,6vw,80px) 120px",
          maxWidth: 1080,
          margin: "0 auto",
        }}
      >
        <h1
          style={{
            margin: "0 0 12px",
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(48px,11vw,88px)",
            fontWeight: 300,
            color: TEXT,
            letterSpacing: "0.02em",
            lineHeight: 1,
          }}
        >
          Subscriptions
        </h1>
        <p
          style={{
            margin: "0 0 48px",
            fontFamily: "var(--font-body)",
            fontSize: 13,
            fontWeight: 300,
            letterSpacing: "0.02em",
            color: "rgba(251,243,212,0.65)",
          }}
        >
          Fresh bread, on your schedule.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {cards.map((c, i) => (
            <Link
              key={c.href}
              href={c.href}
              className="cdx-hub-card"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                padding: "28px 24px 26px",
                background: WALNUT,
                border: "1px solid rgba(201,169,110,0.18)",
                borderRadius: 4,
                color: CREAM,
                textDecoration: "none",
                minHeight: 168,
                animationDelay: `${i * 100}ms`,
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                {c.icon}
                <span
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 10,
                    fontWeight: 300,
                    letterSpacing: "0.35em",
                    textTransform: "uppercase",
                    color: "rgba(201,169,110,0.7)",
                  }}
                >
                  →
                </span>
              </div>
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 28,
                  fontWeight: 400,
                  letterSpacing: "0.01em",
                  lineHeight: 1.1,
                  color: CREAM,
                }}
              >
                {c.title}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 13,
                  fontWeight: 300,
                  lineHeight: 1.45,
                  color: "rgba(245,240,232,0.62)",
                }}
              >
                {c.caption}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
