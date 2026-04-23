"use client";

import { useState } from "react";
import Link from "next/link";
import { VIZAG_AREAS, STORES } from "@/lib/data";

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export default function StoreLocatorPage() {
  const [selected, setSelected] = useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = VIZAG_AREAS.filter(a => a.toLowerCase().includes(query.toLowerCase()));
  const results = selected ? (STORES[selected] ?? []) : null;

  function pick(area: string) { setSelected(area); setQuery(area); setOpen(false); }

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

      <div style={{ position: "relative", zIndex: 1, padding: "100px clamp(28px,8vw,120px) 120px" }}>
        <h1 style={{ margin: "0 0 48px", fontFamily: "var(--font-heading)", fontSize: "clamp(52px,12vw,96px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1 }}>
          Find Cadieux
        </h1>

        <div style={{ maxWidth: 440 }}>
          <p style={{ margin: "0 0 16px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(251,243,212,0.5)" }}>
            Select your area in Vizag
          </p>

          <div style={{ position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", border: "1px solid rgba(251,243,212,0.2)", background: "rgba(251,243,212,0.04)", padding: "14px 16px", cursor: "text" }} onClick={() => setOpen(true)}>
              <input
                value={query}
                onChange={e => { setQuery(e.target.value); setSelected(""); setOpen(true); }}
                onFocus={() => { setQuery(""); setOpen(true); }}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                placeholder="Type or select an area…"
                style={{ flex: 1, background: "none", border: "none", outline: "none", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "#FBF3D4" }}
              />
              <span
                onClick={e => { e.stopPropagation(); if (open) setOpen(false); else { setQuery(""); setOpen(true); } }}
                style={{ cursor: "pointer", userSelect: "none", color: "rgba(251,243,212,0.4)", fontSize: 14, transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", display: "inline-block", lineHeight: 1 }}
              >▾</span>
            </div>

            {open && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#1a1a1c", border: "1px solid rgba(251,243,212,0.12)", borderTop: "none", maxHeight: "calc(7 * 48px)", overflowY: "auto", overscrollBehavior: "contain" }}>
                {filtered.length === 0 ? (
                  <div style={{ padding: "14px 16px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(251,243,212,0.3)" }}>No areas found</div>
                ) : filtered.map(area => (
                  <button
                    key={area}
                    onMouseDown={e => { e.preventDefault(); pick(area); }}
                    style={{ display: "block", width: "100%", background: "none", border: "none", borderBottom: "1px solid rgba(251,243,212,0.06)", padding: "14px 16px", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: selected === area ? "#FBF3D4" : "rgba(251,243,212,0.55)", WebkitTapHighlightColor: "transparent" }}
                  >{area}</button>
                ))}
              </div>
            )}
          </div>

          {selected && results !== null && (
            <div style={{ marginTop: 40 }}>
              {results.length === 0 ? (
                <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(251,243,212,0.35)" }}>No stores found in {selected} yet.</p>
              ) : results.map((s, i) => (
                <div key={i} style={{ borderTop: "1px solid rgba(251,243,212,0.1)", paddingTop: 20 }}>
                  <p style={{ margin: "0 0 8px", fontFamily: "var(--font-heading)", fontSize: "clamp(22px,5vw,32px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.01em" }}>{s.name}</p>
                  <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(251,243,212,0.4)" }}>{s.address}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
