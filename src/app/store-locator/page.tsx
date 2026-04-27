"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Refs to each area row, keyed by area name — used for smooth scroll on expand/match.
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Detect mobile after mount to avoid hydration mismatch.
  useEffect(() => {
    setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
  }, []);

  // Close dropdown when clicking outside the search wrapper.
  useEffect(() => {
    if (!dropdownOpen) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [dropdownOpen]);

  // Dropdown options filtered by query.
  const dropdownAreas = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return AREA_NAMES;
    return AREA_NAMES.filter((a) => a.toLowerCase().includes(q));
  }, [query]);

  // Areas to actually render below the search bar — only when user has typed
  // OR picked something. Empty otherwise (per request).
  const visibleAreas = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (picked) return [picked];
    if (!q) return [];
    return AREA_NAMES.filter((a) => a.toLowerCase().includes(q));
  }, [query, picked]);

  function scrollToArea(area: string) {
    requestAnimationFrame(() => {
      rowRefs.current[area]?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function pickArea(area: string) {
    setPicked(area);
    setQuery("");
    setExpanded(area);
    setDropdownOpen(false);
    scrollToArea(area);
  }

  function clearAll() {
    setQuery("");
    setPicked(null);
    setExpanded(null);
    setDropdownOpen(false);
  }

  function handleHeaderClick(area: string) {
    const willOpen = expanded !== area;
    setExpanded(willOpen ? area : null);
    if (willOpen) scrollToArea(area);
  }

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
          margin: "0 0 28px",
          fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200,
          letterSpacing: "0.3em", textTransform: "uppercase",
          color: "rgba(251,243,212,0.5)",
        }}>
          Stores we supply across Vizag
        </p>

        {/* Search bar + dropdown */}
        <div ref={wrapRef} style={{ position: "relative", marginBottom: 24 }}>
          <input
            type="text"
            value={picked && !query ? picked : query}
            onChange={(e) => { setPicked(null); setQuery(e.target.value); setDropdownOpen(true); }}
            onFocus={() => setDropdownOpen(true)}
            onClick={() => setDropdownOpen(true)}
            placeholder="Search area"
            aria-label="Search area"
            aria-expanded={dropdownOpen}
            aria-controls="area-dropdown"
            style={{
              width: "100%",
              background: "#0a0805",
              border: `0.5px solid rgba(${GOLD},0.45)`,
              borderRadius: 12,
              padding: "14px 44px 14px 18px",
              color: "#f5f0e8",
              fontFamily: "var(--font-body)",
              fontSize: 14, fontWeight: 300,
              letterSpacing: "0.04em",
              outline: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          />
          {(query || picked) && (
            <button
              type="button"
              onClick={clearAll}
              aria-label="Clear selection"
              style={{
                position: "absolute", right: 10, top: 22, transform: "translateY(-50%)",
                background: "transparent", border: "none", cursor: "pointer",
                color: `rgba(${GOLD},0.85)`,
                fontSize: 18, lineHeight: 1, padding: 8,
                WebkitTapHighlightColor: "transparent",
                zIndex: 2,
              }}
            >×</button>
          )}

          {/* Scrollable dropdown */}
          {dropdownOpen && (
            <div
              id="area-dropdown"
              role="listbox"
              className="cdx-area-dropdown"
              style={{
                position: "absolute", left: 0, right: 0, top: "calc(100% + 6px)",
                background: "#0a0805",
                border: `0.5px solid rgba(${GOLD},0.45)`,
                borderRadius: 12,
                maxHeight: 240,
                overflowY: "auto",
                WebkitOverflowScrolling: "touch",
                overscrollBehavior: "contain",
                touchAction: "pan-y",
                zIndex: 5,
                boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
              }}
            >
              {dropdownAreas.length === 0 && (
                <p style={{
                  margin: 0, padding: "14px 18px",
                  fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300,
                  color: "rgba(240,223,200,0.4)", letterSpacing: "0.04em",
                }}>No areas match &ldquo;{query}&rdquo;.</p>
              )}
              {dropdownAreas.map((area) => (
                <button
                  key={area}
                  type="button"
                  role="option"
                  aria-selected={picked === area}
                  onClick={() => pickArea(area)}
                  className="cdx-area-option"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    width: "100%",
                    background: "transparent", border: "none", cursor: "pointer",
                    padding: "12px 18px",
                    textAlign: "left",
                    color: "#f5f0e8",
                    fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 300,
                    letterSpacing: "0.02em",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span>{area}</span>
                  <span style={{
                    fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300,
                    color: "#8a7a5a",
                    letterSpacing: "0.18em", textTransform: "uppercase",
                  }}>{RETAILERS[area].length} stores</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {visibleAreas.map((area) => {
            const retailers = RETAILERS[area];
            const isOpen = expanded === area;
            const panelId = `area-panel-${area.replace(/[^a-z0-9]+/gi, "-")}`;
            return (
              <div key={area} ref={(el) => { rowRefs.current[area] = el; }}>
                {/* Area header */}
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  aria-label={`${area}, ${retailers.length} stores, ${isOpen ? "collapse" : "expand"}`}
                  onClick={() => handleHeaderClick(area)}
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
        input::placeholder { color: rgba(240,223,200,0.3); }
        input:focus { border-color: rgba(${GOLD},0.85) !important; }
        .cdx-area-option:hover { background: rgba(${GOLD},0.08) !important; }
        .cdx-area-option:focus-visible { outline: 2px solid rgba(${GOLD},0.7); outline-offset: -2px; }
        .cdx-area-dropdown::-webkit-scrollbar { width: 6px; }
        .cdx-area-dropdown::-webkit-scrollbar-track { background: transparent; }
        .cdx-area-dropdown::-webkit-scrollbar-thumb { background: rgba(${GOLD},0.4); border-radius: 3px; }
        .cdx-area-dropdown { scrollbar-width: thin; scrollbar-color: rgba(${GOLD},0.4) transparent; }
      `}</style>
    </div>
  );
}
