"use client";

// Typed-area input for the /admin/orders "nearest from area" sort.
//
// Sunny types an area or a 6-digit pincode ("MVP", "Akkayyapalem",
// "530017") → hits Enter or clicks Match → we resolve it against
// public.service_areas via /api/admin/areas/resolve → the parent gets
// an { latitude, longitude, label } anchor and flips the sort to
// "nearest_from_area". Clearing the anchor drops the sort back to
// whatever it was before.
//
// Deliberately no autocomplete dropdown — Sunny's brief was "type an
// area", not "pick one". The resolved-match line under the input
// shows what actually got matched so ambiguity is at least visible.

import { useCallback, useState } from "react";

import { adminAuthHeaders } from "@/lib/admin-client";

export type ResolvedArea = {
  latitude: number;
  longitude: number;
  label: string;
  matched_via: string;
};

export function AreaSortControl({
  anchor,
  onResolve,
  onClear,
}: {
  anchor: ResolvedArea | null;
  onResolve: (a: ResolvedArea) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const resolve = useCallback(async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/areas/resolve", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...adminAuthHeaders(),
        },
        body: JSON.stringify({ query: q }),
      });
      if (r.status === 404) {
        setErr("No match");
        return;
      }
      if (!r.ok) {
        setErr("Lookup failed");
        return;
      }
      const d = (await r.json()) as {
        area_name: string | null;
        pincode: string | null;
        latitude: number;
        longitude: number;
        matched_via: string;
      };
      const label =
        (d.area_name ?? "") + (d.pincode ? ` (${d.pincode})` : "");
      onResolve({
        latitude: d.latitude,
        longitude: d.longitude,
        label: label.trim() || q,
        matched_via: d.matched_via,
      });
      setQuery("");
    } catch {
      setErr("Lookup failed");
    } finally {
      setBusy(false);
    }
  }, [query, busy, onResolve]);

  const inputStyle: React.CSSProperties = {
    border: "1px solid rgba(251,243,212,0.3)",
    background: "transparent",
    color: "#FBF3D4",
    fontFamily: "var(--font-body)",
    fontSize: "1rem",
    letterSpacing: "0.05em",
    padding: "8px 12px",
    minWidth: 200,
  };

  const btn: React.CSSProperties = {
    border: "1px solid rgba(251,243,212,0.35)",
    background: "transparent",
    color: "#FBF3D4",
    fontFamily: "var(--font-body)",
    fontSize: "0.875rem",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    padding: "8px 12px",
    cursor: busy ? "wait" : "pointer",
    opacity: busy ? 0.6 : 1,
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {anchor ? (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            border: "1px solid rgba(251,243,212,0.35)",
            borderRadius: 999,
            color: "#FBF3D4",
            fontFamily: "var(--font-body)",
            fontSize: "0.9rem",
          }}
          title={`Sort by distance from ${anchor.label} · matched ${anchor.matched_via}`}
        >
          <span style={{ letterSpacing: "0.05em" }}>Sort from: {anchor.label}</span>
          <button
            type="button"
            aria-label="Clear area sort"
            onClick={onClear}
            style={{
              background: "transparent",
              border: "none",
              color: "#FBF3D4",
              cursor: "pointer",
              fontSize: "1rem",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void resolve();
              }
            }}
            placeholder="Sort from area (MVP, Akkayyapalem, 530017)"
            disabled={busy}
            style={inputStyle}
          />
          <button
            type="button"
            onClick={() => void resolve()}
            disabled={busy || query.trim().length === 0}
            style={btn}
          >
            {busy ? "Matching…" : "Match"}
          </button>
          {err ? (
            <span
              style={{
                color: "#EF4444",
                fontFamily: "var(--font-body)",
                fontSize: "0.85rem",
              }}
            >
              {err}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}
