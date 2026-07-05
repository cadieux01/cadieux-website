"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ScrollReveal from "@/components/ScrollReveal";
import { RETAILERS } from "@/lib/data";

const GRAIN = "url(/grain.svg)";

const AREA_NAMES = Object.keys(RETAILERS);

const GOLD = "251,243,212";

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

  // Unified prediction list: areas + stores, filtered by query.
  type Prediction =
    | { kind: "area"; area: string; label: string; sub: string }
    | { kind: "store"; area: string; label: string; sub: string };

  const predictions = useMemo<Prediction[]>(() => {
    const q = query.trim().toLowerCase();
    const items: Prediction[] = [];
    for (const area of AREA_NAMES) {
      if (!q || area.toLowerCase().includes(q)) {
        items.push({ kind: "area", area, label: area, sub: `${RETAILERS[area].length} stores` });
      }
      for (const r of RETAILERS[area]) {
        if (q && (r.name.toLowerCase().includes(q) || r.address.toLowerCase().includes(q))) {
          items.push({ kind: "store", area, label: r.name, sub: area });
        }
      }
    }
    return items;
  }, [query]);

  // Accordion area card only renders for the picked area — never auto-shown
  // while typing. The dropdown is the only prediction surface during typing.
  const visibleAreas = useMemo(() => (picked ? [picked] : []), [picked]);

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
    <div style={{ minHeight: "100dvh", background: "#C0C8CE", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.04, mixBlendMode: "multiply", pointerEvents: "none", zIndex: 0 }} />

      {/* Back link */}
      <Link href="/" style={{
        position: "fixed", top: "calc(24px + env(safe-area-inset-top))", left: "calc(20px + env(safe-area-inset-left))", zIndex: 101,
        fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
        letterSpacing: "0.35em", textTransform: "uppercase",
        color: "#024628", textDecoration: "none",
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
            color: "#024628", letterSpacing: "0.02em", lineHeight: 1,
          }}>
            Find Cadieux
          </h1>
        </ScrollReveal>

        <p style={{
          margin: "0 0 28px",
          fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200,
          letterSpacing: "0.3em", textTransform: "uppercase",
          color: "rgba(2,70,40,0.75)",
        }}>
          Stores we supply across Vizag
        </p>

        {/* Search bar + dropdown */}
        <div ref={wrapRef} style={{ position: "relative", marginBottom: 24 }}>
          <input
            type="text"
            value={picked && !query ? picked : query}
            onChange={(e) => { setPicked(null); setQuery(e.target.value); setDropdownOpen(e.target.value.trim().length > 0); }}
            placeholder="Search area"
            aria-label="Search area"
            aria-expanded={dropdownOpen}
            aria-controls="area-dropdown"
            style={{
              width: "100%",
              background: "#024628",
              border: `0.5px solid rgba(${GOLD},0.45)`,
              borderRadius: 12,
              padding: "14px 44px 14px 18px",
              color: "#FBF3D4",
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
              data-lenis-prevent
              style={{
                position: "absolute", left: 0, right: 0, top: "calc(100% + 6px)",
                background: "#024628",
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
              {predictions.length === 0 && (
                <p style={{
                  margin: 0, padding: "14px 18px",
                  fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300,
                  color: "rgba(251,243,212,0.55)", letterSpacing: "0.04em",
                }}>No matches for &ldquo;{query}&rdquo;.</p>
              )}
              {predictions.map((p, i) => (
                <button
                  key={`${p.kind}-${p.area}-${p.label}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={picked === p.area && p.kind === "area"}
                  onClick={() => pickArea(p.area)}
                  className="cdx-area-option"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    gap: 12,
                    width: "100%",
                    background: "transparent", border: "none", cursor: "pointer",
                    padding: "12px 18px",
                    textAlign: "left",
                    color: "#FBF3D4",
                    fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 300,
                    letterSpacing: "0.02em",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span style={{
                    display: "flex", alignItems: "center", gap: 10,
                    minWidth: 0, flex: 1,
                  }}>
                    <span aria-hidden="true" style={{
                      fontSize: 11,
                      color: `rgba(${GOLD},0.7)`,
                      flexShrink: 0,
                      width: 14, textAlign: "center",
                    }}>{p.kind === "area" ? "◆" : "◦"}</span>
                    <span style={{
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{p.label}</span>
                  </span>
                  <span style={{
                    fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300,
                    color: "rgba(251,243,212,0.6)",
                    letterSpacing: "0.18em", textTransform: "uppercase",
                    flexShrink: 0,
                  }}>{p.sub}</span>
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
                    background: "#024628",
                    border: `0.5px solid rgba(${GOLD},0.45)`,
                    borderRadius: 12,
                    padding: "16px 20px",
                    cursor: "pointer",
                    color: "#FBF3D4",
                    textAlign: "left",
                    transition: "background 200ms ease, border-color 200ms ease",
                    WebkitTapHighlightColor: "transparent",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(251,243,212,0.08)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "#024628"; }}
                >
                  <span style={{
                    flex: 1,
                    fontFamily: "var(--font-heading)",
                    fontSize: 20, fontWeight: 400,
                    color: "#FBF3D4",
                    letterSpacing: "0.01em",
                  }}>{area}</span>
                  <span style={{
                    fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
                    color: "rgba(251,243,212,0.6)",
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
                              background: "#024628",
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
                              color: "#FBF3D4",
                              letterSpacing: "0.02em",
                            }}>{r.name}</p>
                            <p style={{
                              margin: 0,
                              fontFamily: "var(--font-body)",
                              fontSize: 11, fontWeight: 300,
                              color: "rgba(251,243,212,0.7)",
                              letterSpacing: "0.04em",
                              lineHeight: 1.5,
                            }}>{r.address}</p>
                            <p style={{
                              margin: 0,
                              fontFamily: "var(--font-body)",
                              fontSize: 10, fontWeight: 300,
                              color: "rgba(251,243,212,0.6)",
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
        input::placeholder { color: rgba(251,243,212,0.4); }
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
