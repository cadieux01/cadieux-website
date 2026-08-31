"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const GOLD = "251,243,212";

type StoreRef = { name: string; address: string };
type AreaRef = { name: string; slug: string; stores: StoreRef[] };

type Prediction =
  | { kind: "area"; area: AreaRef; label: string; sub: string }
  | { kind: "store"; area: AreaRef; label: string; sub: string };

// Client-only island: the type-ahead search over areas + stores. The full
// stockist list is server-rendered by the parent page so the DOM contains
// every area/store name/address in the initial HTML — this island only
// adds a scroll-to-area affordance on top of that content.
export default function StoreLocatorSearch({ areas }: { areas: AreaRef[] }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

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

  const predictions = useMemo<Prediction[]>(() => {
    const q = query.trim().toLowerCase();
    const items: Prediction[] = [];
    for (const area of areas) {
      if (!q || area.name.toLowerCase().includes(q)) {
        items.push({ kind: "area", area, label: area.name, sub: `${area.stores.length} stores` });
      }
      for (const s of area.stores) {
        if (q && (s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q))) {
          items.push({ kind: "store", area, label: s.name, sub: area.name });
        }
      }
    }
    return items;
  }, [areas, query]);

  function pickArea(area: AreaRef) {
    setPicked(area.name);
    setQuery("");
    setDropdownOpen(false);
    requestAnimationFrame(() => {
      const el = document.getElementById(area.slug);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function clearAll() {
    setQuery("");
    setPicked(null);
    setDropdownOpen(false);
  }

  return (
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
          fontSize: 16, fontWeight: 300,
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
              fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 300,
              color: "rgba(251,243,212,0.55)", letterSpacing: "0.04em",
            }}>No matches for &ldquo;{query}&rdquo;.</p>
          )}
          {predictions.map((p, i) => (
            <button
              key={`${p.kind}-${p.area.slug}-${p.label}-${i}`}
              type="button"
              role="option"
              aria-selected={picked === p.area.name && p.kind === "area"}
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
                  fontSize: 16,
                  color: `rgba(${GOLD},0.7)`,
                  flexShrink: 0,
                  width: 14, textAlign: "center",
                }}>{p.kind === "area" ? "◆" : "◦"}</span>
                <span style={{
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{p.label}</span>
              </span>
              <span style={{
                fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
                color: "rgba(251,243,212,0.6)",
                letterSpacing: "0.18em", textTransform: "uppercase",
                flexShrink: 0,
              }}>{p.sub}</span>
            </button>
          ))}
        </div>
      )}

      <style>{`
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
