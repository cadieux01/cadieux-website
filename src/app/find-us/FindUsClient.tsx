"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { GoogleMap, Marker, InfoWindow, useJsApiLoader } from "@react-google-maps/api";

import {
  COMMUNITY_COUNT,
  LOCATIONS,
  STALL_COUNT,
  ZONES,
  haversineKm,
  isServedPincode,
  nearestStall,
  type CadieuxLocation,
  type CadieuxLocationType,
} from "@/lib/find-us-locations";

// Brand tokens (match the rest of the site — see store-locator/page.tsx).
const GOLD_RGB = "201,169,110";
const GREEN_HEX = "#2F6A3A"; // stall pin
const GOLD_HEX = "#C9A96E"; // community pin
const VIZAG_CENTER = { lat: 17.74, lng: 83.30 };

// Tab definitions. Disabled tabs render but are not clickable — they signal
// upcoming categories without breaking the layout.
type TabKey = "all" | "stall" | "community" | "gym" | "store" | "club";

const TABS: ReadonlyArray<{
  key: TabKey;
  label: string;
  count?: number;
  disabled?: boolean;
}> = [
  { key: "all", label: "All", count: STALL_COUNT + COMMUNITY_COUNT },
  { key: "stall", label: "Stalls", count: STALL_COUNT },
  { key: "community", label: "Gated Communities", count: COMMUNITY_COUNT },
  { key: "gym", label: "Gyms", disabled: true },
  { key: "store", label: "Stores", disabled: true },
  { key: "club", label: "Fitness Clubs", disabled: true },
];

// Open Google Maps directions for the given location. We have no street
// address in the dataset, so build a name + area + city query — Google
// geocodes that with high accuracy in Vizag. As a backstop we tack on the
// lat/lng coordinates so even ambiguous community names resolve.
function navigateTo(loc: CadieuxLocation) {
  const q = encodeURIComponent(`${loc.name}, ${loc.area}, Visakhapatnam`);
  const ll = `${loc.latitude},${loc.longitude}`;
  window.open(
    `https://www.google.com/maps/dir/?api=1&destination=${q}&destination_place_id=&travelmode=driving&query=${ll}`,
    "_blank",
    "noopener,noreferrer",
  );
}

function typeBadge(type: CadieuxLocationType): string {
  if (type === "stall") return "Stall";
  if (type === "community") return "Gated Community";
  if (type === "gym") return "Gym";
  if (type === "store") return "Store";
  return "Fitness Club";
}

const MAP_CONTAINER_STYLE = { width: "100%", height: "100%" };

const MAP_OPTIONS: google.maps.MapOptions = {
  disableDefaultUI: false,
  zoomControl: true,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
  clickableIcons: false,
  // Cadieux dark brand styling — keeps the map readable on rgb(6,4,2).
  styles: [
    { elementType: "geometry", stylers: [{ color: "#1a1612" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#1a1612" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#9a8964" }] },
    { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#2a2520" }] },
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#8a7a5a" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#0c0a08" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3a5566" }] },
  ],
};

export default function FindUsClient({ apiKey }: { apiKey: string }) {
  const { isLoaded } = useJsApiLoader({
    id: "cdx-find-us-map",
    googleMapsApiKey: apiKey,
  });

  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");
  const [pincode, setPincode] = useState("");
  const [pincodeResult, setPincodeResult] = useState<
    | { kind: "served"; nearest: ReturnType<typeof nearestStall> }
    | { kind: "unserved" }
    | null
  >(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(
    null,
  );

  // Optional geolocation — silent on refusal; only used to show distance.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        /* user denied — silent */
      },
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 5 * 60_000 },
    );
  }, []);

  // Filter pipeline: tab + free-text search (name OR area).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return LOCATIONS.filter((loc) => {
      if (activeTab !== "all" && loc.type !== activeTab) return false;
      if (!q) return true;
      return (
        loc.name.toLowerCase().includes(q) ||
        loc.area.toLowerCase().includes(q) ||
        loc.zone.toLowerCase().includes(q)
      );
    });
  }, [activeTab, search]);

  // Group filtered list by zone, preserving the order from ZONES.
  const grouped = useMemo(() => {
    const byZone = new Map<string, CadieuxLocation[]>();
    for (const z of ZONES) byZone.set(z, []);
    for (const loc of filtered) {
      const bucket = byZone.get(loc.zone);
      if (bucket) bucket.push(loc);
      else byZone.set(loc.zone, [loc]);
    }
    return Array.from(byZone.entries()).filter(([, items]) => items.length > 0);
  }, [filtered]);

  const selected = useMemo(
    () => LOCATIONS.find((l) => l.id === selectedId) ?? null,
    [selectedId],
  );

  function checkPincode(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = pincode.trim();
    if (!/^\d{6}$/.test(trimmed) || !isServedPincode(trimmed)) {
      setPincodeResult({ kind: "unserved" });
      return;
    }
    // No pincode-to-area lookup in our dataset; fall back to the city
    // centroid for the "nearest stall" recommendation. The user can
    // re-check after browsing the map for a sharper pick.
    setPincodeResult({
      kind: "served",
      nearest: nearestStall(VIZAG_CENTER.lat, VIZAG_CENTER.lng),
    });
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "rgb(6,4,2)",
        position: "relative",
        overflowX: "clip",
      }}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: "url(/grain.svg)",
          opacity: 0.055,
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* Back link */}
      <Link
        href="/"
        style={{
          position: "fixed",
          top: 24,
          left: 20,
          zIndex: 101,
          fontFamily: "var(--font-body)",
          fontSize: 10,
          fontWeight: 200,
          letterSpacing: "0.35em",
          textTransform: "uppercase",
          color: "#4369B2",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 14 }}>←</span> Cadieux
      </Link>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "100px clamp(20px,5vw,64px) 120px",
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        {/* Hero */}
        <h1
          style={{
            margin: "0 0 12px",
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(40px,9vw,76px)",
            fontWeight: 300,
            color: "#FBF3D4",
            letterSpacing: "0.02em",
            lineHeight: 1,
          }}
        >
          Find Cadieux Near You
        </h1>
        <p
          style={{
            margin: "0 0 36px",
            fontFamily: "var(--font-body)",
            fontSize: 14,
            fontWeight: 300,
            color: "rgba(251,243,212,0.6)",
            letterSpacing: "0.02em",
            lineHeight: 1.6,
            maxWidth: 640,
          }}
        >
          {STALL_COUNT} stalls across Visakhapatnam, with delivery to{" "}
          {COMMUNITY_COUNT}+ gated communities and growing.
        </p>

        {/* Map */}
        <div
          style={{
            width: "100%",
            height: "clamp(300px, 50vh, 460px)",
            borderRadius: 12,
            overflow: "hidden",
            border: `0.5px solid rgba(${GOLD_RGB},0.35)`,
            background: "#0a0805",
            marginBottom: 24,
          }}
        >
          {isLoaded ? (
            <GoogleMap
              mapContainerStyle={MAP_CONTAINER_STYLE}
              center={VIZAG_CENTER}
              zoom={11}
              options={MAP_OPTIONS}
              onClick={() => setSelectedId(null)}
            >
              {filtered
                .filter((l) => l.type === "stall" || l.type === "community")
                .map((loc) => (
                  <Marker
                    key={loc.id}
                    position={{ lat: loc.latitude, lng: loc.longitude }}
                    onClick={() => setSelectedId(loc.id)}
                    icon={{
                      path: google.maps.SymbolPath.CIRCLE,
                      scale: loc.type === "stall" ? 9 : 6,
                      fillColor:
                        loc.type === "stall" ? GREEN_HEX : GOLD_HEX,
                      fillOpacity: 0.95,
                      strokeColor: "#000",
                      strokeWeight: 1,
                    }}
                  />
                ))}

              {selected && (
                <InfoWindow
                  position={{ lat: selected.latitude, lng: selected.longitude }}
                  onCloseClick={() => setSelectedId(null)}
                >
                  <div style={{ color: "#1a1612", maxWidth: 220, padding: 4 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 14,
                        marginBottom: 4,
                      }}
                    >
                      {selected.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        opacity: 0.75,
                        marginBottom: 6,
                      }}
                    >
                      {typeBadge(selected.type)} · {selected.area}
                    </div>
                    <button
                      type="button"
                      onClick={() => navigateTo(selected)}
                      style={{
                        background: "#2F6A3A",
                        color: "#fff",
                        border: "none",
                        borderRadius: 4,
                        padding: "6px 10px",
                        fontSize: 11,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        cursor: "pointer",
                      }}
                    >
                      Get Directions
                    </button>
                  </div>
                </InfoWindow>
              )}
            </GoogleMap>
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "rgba(251,243,212,0.4)",
                fontFamily: "var(--font-body)",
                fontSize: 12,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
              }}
            >
              Loading map…
            </div>
          )}
        </div>

        {/* Map legend */}
        <div
          style={{
            display: "flex",
            gap: 24,
            flexWrap: "wrap",
            marginBottom: 32,
            fontFamily: "var(--font-body)",
            fontSize: 11,
            color: "rgba(251,243,212,0.6)",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                background: GREEN_HEX,
                border: "1px solid #000",
              }}
            />
            Stall ({STALL_COUNT})
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                background: GOLD_HEX,
                border: "1px solid #000",
              }}
            />
            Gated Community ({COMMUNITY_COUNT})
          </span>
        </div>

        {/* Pincode checker */}
        <form
          onSubmit={checkPincode}
          style={{
            background: "#0a0805",
            border: `0.5px solid rgba(${GOLD_RGB},0.35)`,
            borderRadius: 12,
            padding: "20px 24px",
            marginBottom: 32,
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            alignItems: "flex-end",
          }}
        >
          <div style={{ flex: "1 1 220px" }}>
            <label
              htmlFor="cdx-pincode"
              style={{
                display: "block",
                fontFamily: "var(--font-body)",
                fontSize: 10,
                fontWeight: 400,
                letterSpacing: "0.25em",
                textTransform: "uppercase",
                color: "rgba(251,243,212,0.55)",
                marginBottom: 8,
              }}
            >
              Check your pincode
            </label>
            <input
              id="cdx-pincode"
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="e.g. 530017"
              value={pincode}
              onChange={(e) => {
                setPincode(e.target.value.replace(/\D/g, ""));
                setPincodeResult(null);
              }}
              style={{
                width: "100%",
                background: "#080604",
                border: `0.5px solid rgba(${GOLD_RGB},0.45)`,
                borderRadius: 8,
                padding: "12px 14px",
                color: "#f5f0e8",
                fontFamily: "var(--font-body)",
                fontSize: 14,
                outline: "none",
              }}
            />
          </div>
          <button
            type="submit"
            className="cdx-locator-btn"
            style={{
              background: "transparent",
              border: `1px solid rgba(${GOLD_RGB},0.6)`,
              borderRadius: 8,
              padding: "12px 22px",
              fontFamily: "var(--font-body)",
              fontSize: 11,
              fontWeight: 400,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: `rgba(${GOLD_RGB},0.95)`,
              cursor: "pointer",
            }}
          >
            Check
          </button>
          {pincodeResult && (
            <p
              style={{
                margin: 0,
                width: "100%",
                fontFamily: "var(--font-body)",
                fontSize: 13,
                color:
                  pincodeResult.kind === "served"
                    ? "#9bd0a3"
                    : "rgba(251,243,212,0.7)",
                lineHeight: 1.5,
              }}
            >
              {pincodeResult.kind === "served" ? (
                <>
                  ✓ Yes — Cadieux delivers to{" "}
                  <strong>{pincode}</strong>.
                  {pincodeResult.nearest && (
                    <>
                      {" "}Nearest stall:{" "}
                      <strong>{pincodeResult.nearest.stall.name}</strong> (
                      {pincodeResult.nearest.distanceKm.toFixed(1)} km).
                    </>
                  )}
                </>
              ) : (
                <>Sorry — Cadieux doesn&apos;t deliver to that pincode yet.</>
              )}
            </p>
          )}
        </form>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Filter locations by type"
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 20,
          }}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const disabled = !!tab.disabled;
            return (
              <button
                key={tab.key}
                role="tab"
                type="button"
                aria-selected={isActive}
                disabled={disabled}
                onClick={() => !disabled && setActiveTab(tab.key)}
                style={{
                  background: isActive
                    ? `rgba(${GOLD_RGB},0.18)`
                    : "transparent",
                  border: `1px solid rgba(${GOLD_RGB},${
                    isActive ? 0.85 : 0.4
                  })`,
                  borderRadius: 999,
                  padding: "8px 16px",
                  fontFamily: "var(--font-body)",
                  fontSize: 11,
                  fontWeight: 400,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: disabled
                    ? "rgba(251,243,212,0.25)"
                    : isActive
                      ? "#FBF3D4"
                      : `rgba(${GOLD_RGB},0.85)`,
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                {tab.label}
                {typeof tab.count === "number" && (
                  <span style={{ marginLeft: 8, opacity: 0.7 }}>
                    {tab.count}
                  </span>
                )}
                {disabled && (
                  <span style={{ marginLeft: 8, opacity: 0.7 }}>Soon</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, area or zone…"
          aria-label="Search locations"
          style={{
            width: "100%",
            background: "#0a0805",
            border: `0.5px solid rgba(${GOLD_RGB},0.45)`,
            borderRadius: 12,
            padding: "14px 18px",
            color: "#f5f0e8",
            fontFamily: "var(--font-body)",
            fontSize: 14,
            fontWeight: 300,
            letterSpacing: "0.04em",
            outline: "none",
            marginBottom: 28,
          }}
        />

        {/* Grouped list */}
        {grouped.length === 0 ? (
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 13,
              color: "rgba(251,243,212,0.5)",
              textAlign: "center",
              padding: "40px 0",
            }}
          >
            No locations match your filters.
          </p>
        ) : (
          grouped.map(([zone, items]) => (
            <section key={zone} style={{ marginBottom: 36 }}>
              <h2
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 20,
                  fontWeight: 400,
                  color: "#FBF3D4",
                  letterSpacing: "0.02em",
                  margin: "0 0 14px",
                }}
              >
                {zone}
                <span
                  style={{
                    marginLeft: 12,
                    fontFamily: "var(--font-body)",
                    fontSize: 10,
                    fontWeight: 300,
                    color: "#8a7a5a",
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                  }}
                >
                  {items.length}{" "}
                  {items.length === 1 ? "location" : "locations"}
                </span>
              </h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(260px, 1fr))",
                  gap: 12,
                }}
              >
                {items.map((loc) => {
                  const dist = userLoc
                    ? haversineKm(
                        userLoc.lat,
                        userLoc.lng,
                        loc.latitude,
                        loc.longitude,
                      )
                    : null;
                  return (
                    <article
                      key={loc.id}
                      style={{
                        background: "#080604",
                        border: `0.25px solid rgba(${GOLD_RGB},0.3)`,
                        borderRadius: 10,
                        padding: "16px 18px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <h3
                          style={{
                            margin: 0,
                            fontFamily: "var(--font-body)",
                            fontSize: 15,
                            fontWeight: 500,
                            color: "#f5f0e8",
                            letterSpacing: "0.01em",
                          }}
                        >
                          {loc.name}
                        </h3>
                        <span
                          style={{
                            fontFamily: "var(--font-body)",
                            fontSize: 9,
                            fontWeight: 400,
                            letterSpacing: "0.18em",
                            textTransform: "uppercase",
                            color:
                              loc.type === "stall"
                                ? "#9bd0a3"
                                : `rgba(${GOLD_RGB},0.9)`,
                            border: `0.5px solid ${
                              loc.type === "stall"
                                ? "rgba(155,208,163,0.4)"
                                : `rgba(${GOLD_RGB},0.4)`
                            }`,
                            borderRadius: 4,
                            padding: "3px 7px",
                            flexShrink: 0,
                          }}
                        >
                          {typeBadge(loc.type)}
                        </span>
                      </div>
                      <p
                        style={{
                          margin: 0,
                          fontFamily: "var(--font-body)",
                          fontSize: 11,
                          fontWeight: 300,
                          color: "#8a7a5a",
                          letterSpacing: "0.03em",
                          lineHeight: 1.5,
                        }}
                      >
                        {loc.area}
                        {typeof loc.rating === "number" && (
                          <>
                            {" "}· <span style={{ color: "#c9a96e" }}>
                              ★ {loc.rating.toFixed(1)}
                            </span>
                          </>
                        )}
                      </p>
                      {(loc.notes || dist !== null) && (
                        <p
                          style={{
                            margin: 0,
                            fontFamily: "var(--font-body)",
                            fontSize: 10,
                            fontWeight: 300,
                            color: "#6a5a40",
                            letterSpacing: "0.18em",
                            textTransform: "uppercase",
                          }}
                        >
                          {loc.notes}
                          {loc.notes && dist !== null ? " · " : ""}
                          {dist !== null && `${dist.toFixed(1)} km away`}
                        </p>
                      )}
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "flex-end",
                          marginTop: 4,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => navigateTo(loc)}
                          aria-label={`Get directions to ${loc.name}`}
                          className="cdx-locator-btn"
                          style={{
                            background: "transparent",
                            border: `1px solid rgba(${GOLD_RGB},0.5)`,
                            borderRadius: 6,
                            padding: "7px 14px",
                            fontFamily: "var(--font-body)",
                            fontSize: 10,
                            fontWeight: 400,
                            letterSpacing: "0.25em",
                            textTransform: "uppercase",
                            color: `rgba(${GOLD_RGB},0.95)`,
                            cursor: "pointer",
                          }}
                        >
                          ↗ Directions
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        )}

        {/* CTA: suggest a location */}
        <div
          style={{
            marginTop: 48,
            padding: "28px 24px",
            border: `0.5px solid rgba(${GOLD_RGB},0.35)`,
            borderRadius: 12,
            textAlign: "center",
          }}
        >
          <h2
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 22,
              fontWeight: 400,
              color: "#FBF3D4",
              margin: "0 0 10px",
            }}
          >
            Don&apos;t see your community?
          </h2>
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 13,
              fontWeight: 300,
              color: "rgba(251,243,212,0.6)",
              margin: "0 0 16px",
              lineHeight: 1.6,
            }}
          >
            Tell us where you live — once {`a handful of neighbours sign up,`}
            {" "}we open up your gate.
          </p>
          <a
            href="mailto:hello@cadieux.in?subject=Suggest%20a%20location"
            className="cdx-locator-btn"
            style={{
              display: "inline-block",
              background: "transparent",
              border: `1px solid rgba(${GOLD_RGB},0.6)`,
              borderRadius: 8,
              padding: "12px 22px",
              fontFamily: "var(--font-body)",
              fontSize: 11,
              fontWeight: 400,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: `rgba(${GOLD_RGB},0.95)`,
              textDecoration: "none",
            }}
          >
            Suggest a location
          </a>
        </div>
      </div>

      <style>{`
        .cdx-locator-btn:hover {
          background: rgba(${GOLD_RGB},0.1) !important;
          border-color: rgba(${GOLD_RGB},0.85) !important;
          color: #FBF3D4 !important;
        }
        .cdx-locator-btn:focus-visible {
          outline: 2px solid rgba(${GOLD_RGB},0.9);
          outline-offset: 2px;
        }
        input::placeholder { color: rgba(240,223,200,0.3); }
        input:focus { border-color: rgba(${GOLD_RGB},0.85) !important; }
      `}</style>
    </div>
  );
}
