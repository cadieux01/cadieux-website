"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ScrollReveal from "@/components/ScrollReveal";
import { RETAILERS } from "@/lib/data";

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const AREA_NAMES = Object.keys(RETAILERS);

const GOLD = "201,169,110";

// Universal Google Maps directions URL — opens the Maps app on iOS/Android
// when installed, otherwise google.com/maps in the browser. Uses a name +
// address query so Google geocodes the actual storefront (no guessed coords).
function navigateTo(name: string, address: string) {
  const dest = encodeURIComponent(`${name}, ${address}`);
  const url = `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function StoreLocatorPage() {
  // First area expanded by default; null = all collapsed.
  const [expanded, setExpanded] = useState<string | null>(AREA_NAMES[0] ?? null);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile after mount to avoid hydration mismatch.
  useEffect(() => {
    setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
  }, []);

  return (
    <div style={{ minHeight: "100dvh", background: "rgb(6,4,2)", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />

      {/* Back link */}
      <Link href="/" style={{
        position: "fixed", top: 24, left: 20, zIndex: 101,
        fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
        letterSpacing: "0.35em", textTransform: "uppercase",
        color: "#4369B2", textDecoration: "none",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>←</span> Cadieux
      </Link>

      <div style={{ position: "relative", zIndex: 1, padding: "100px clamp(24px,6vw,80px) 120px", maxWidth: 720, margin: "0 auto" }}>
        <ScrollReveal>
          <h1 data-stagger style={{
            margin: "0 0 12px",
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(48px,11vw,88px)", fontWeight: 300,
            color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1,
          }}>
            Find Cadieux
          </h1>
        </ScrollReveal>

        <p style={{
          margin: "0 0 36px",
          fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200,
          letterSpacing: "0.3em", textTransform: "uppercase",
          color: "rgba(251,243,212,0.5)",
        }}>
          Stores we supply across Vizag
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {AREA_NAMES.map((area) => {
            const retailers = RETAILERS[area];
            const isOpen = expanded === area;
            const panelId = `area-panel-${area.replace(/[^a-z0-9]+/gi, "-")}`;
            return (
              <div key={area}>
                {/* Area header */}
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  aria-label={`${area}, ${retailers.length} stores, ${isOpen ? "collapse" : "expand"}`}
                  onClick={() => setExpanded(isOpen ? null : area)}
                  style={{
                    width: "100%",
                    display: "flex", alignItems: "center", gap: 12,
                    background: "#0a0805",
                    border: `0.5px solid rgba(${GOLD},0.45)`,
                    borderRadius: 12,
                    padding: "16px 20px",
                    cursor: "pointer",
                    color: "#f5f0e8",
                    textAlign: "left",
                    transition: "background 200ms ease, border-color 200ms ease",
                    WebkitTapHighlightColor: "transparent",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,169,110,0.06)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "#0a0805"; }}
                >
                  <span style={{
                    flex: 1,
                    fontFamily: "var(--font-heading)",
                    fontSize: 20, fontWeight: 400,
                    color: "#f5f0e8",
                    letterSpacing: "0.01em",
                  }}>{area}</span>
                  <span style={{
                    fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
                    color: "#8a7a5a",
                    letterSpacing: "0.15em", textTransform: "uppercase",
                  }}>{retailers.length} stores</span>
                  <span aria-hidden="true" style={{
                    color: `rgba(${GOLD},0.7)`,
                    fontSize: 14, lineHeight: 1,
                    transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 300ms ease-out",
                    display: "inline-block",
                  }}>▾</span>
                </button>

                {/* Retailers panel — grid-template-rows trick gives a smooth
                    auto-height accordion with no JS measurement. */}
                <div
                  id={panelId}
                  role="region"
                  aria-label={`${area} retailers`}
                  style={{
                    display: "grid",
                    gridTemplateRows: isOpen ? "1fr" : "0fr",
                    transition: "grid-template-rows 300ms ease-out",
                  }}
                >
                  <div style={{ overflow: "hidden" }}>
                    <div style={{ paddingLeft: 20, paddingTop: 8 }}>
                      {retailers.map((r, i) => {
                        const telHref = `tel:${r.phone.replace(/\s/g, "")}`;
                        return (
                          <div
                            key={`${area}-${i}`}
                            style={{
                              background: "#080604",
                              border: `0.25px solid rgba(${GOLD},0.35)`,
                              borderRadius: 10,
                              padding: "14px 18px",
                              margin: "8px 0",
                              display: "flex",
                              flexDirection: "column",
                              gap: 6,
                            }}
                          >
                            <p style={{
                              margin: 0,
                              fontFamily: "var(--font-body)",
                              fontSize: 14, fontWeight: 400,
                              color: "#f5f0e8",
                              letterSpacing: "0.02em",
                            }}>{r.name}</p>
                            <p style={{
                              margin: 0,
                              fontFamily: "var(--font-body)",
                              fontSize: 11, fontWeight: 300,
                              color: "#6a5a40",
                              letterSpacing: "0.04em",
                              lineHeight: 1.5,
                            }}>{r.address}</p>
                            <p style={{
                              margin: 0,
                              fontFamily: "var(--font-body)",
                              fontSize: 10, fontWeight: 300,
                              color: "#8a7a5a",
                              letterSpacing: "0.18em", textTransform: "uppercase",
                            }}>{r.hours}</p>

                            <div style={{
                              display: "flex", justifyContent: "flex-end",
                              gap: 8, marginTop: 8,
                            }}>
                              <button
                                type="button"
                                onClick={() => navigateTo(r.name, r.address)}
                                aria-label={`${isMobile ? "Open in Google Maps" : "Get directions"} to ${r.name}`}
                                className="cdx-locator-btn"
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 6,
                                  background: "transparent",
                                  border: `1px solid rgba(${GOLD},0.5)`,
                                  borderRadius: 6,
                                  padding: "8px 14px",
                                  fontFamily: "var(--font-body)",
                                  fontSize: 10, fontWeight: 400,
                                  letterSpacing: "0.25em", textTransform: "uppercase",
                                  color: `rgba(${GOLD},0.95)`,
                                  cursor: "pointer",
                                  transition: "background 200ms ease, border-color 200ms ease, color 200ms ease",
                                  WebkitTapHighlightColor: "transparent",
                                }}
                              >
                                {/* Tiny pin glyph */}
                                <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>↗</span>
                                {isMobile ? "Navigate" : "Directions"}
                              </button>
                              <a
                                href={telHref}
                                aria-label={`Call ${r.name} at ${r.phone}`}
                                className="cdx-locator-btn"
                                style={{
                                  display: "inline-flex", alignItems: "center", gap: 6,
                                  background: "transparent",
                                  border: `1px solid rgba(${GOLD},0.5)`,
                                  borderRadius: 6,
                                  padding: "8px 14px",
                                  fontFamily: "var(--font-body)",
                                  fontSize: 10, fontWeight: 400,
                                  letterSpacing: "0.25em", textTransform: "uppercase",
                                  color: `rgba(${GOLD},0.95)`,
                                  textDecoration: "none",
                                  transition: "background 200ms ease, border-color 200ms ease, color 200ms ease",
                                  WebkitTapHighlightColor: "transparent",
                                }}
                              >Call</a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hover + focus styles for buttons */}
      <style>{`
        .cdx-locator-btn:hover {
          background: rgba(${GOLD},0.1) !important;
          border-color: rgba(${GOLD},0.85) !important;
          color: #FBF3D4 !important;
        }
        .cdx-locator-btn:focus-visible {
          outline: 2px solid rgba(${GOLD},0.9);
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
