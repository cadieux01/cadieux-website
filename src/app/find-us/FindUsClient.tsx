"use client";

// Public Find Us screen. Renders every active pickup location from the
// DB-backed `pickup_locations` table (passed in from the server page).
// Pin colours: kitchen=green, stall=gold, partner_pickup=blue.
//
// The pincode checker hits the public /api/service-areas/check route
// so the answer reflects the same data admin/service-areas writes.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { GoogleMap, Marker, InfoWindow, useJsApiLoader } from "@react-google-maps/api";

import {
  GOOGLE_MAPS_LIBRARIES,
  GOOGLE_MAPS_LOADER_ID,
} from "@/lib/google-maps-loader";
import type {
  PickupLocationRow,
  PickupLocationType,
} from "@/lib/pickup-locations";

const GOLD_RGB = "2,70,40";
const GREEN_HEX = "#16a34a"; // kitchen
const GOLD_HEX = "#024628"; // stall
const BLUE_HEX = "#3b82f6"; // partner pickup
const VIZAG_CENTER = { lat: 17.74, lng: 83.3 };

function pinColorFor(type: PickupLocationType): string {
  if (type === "kitchen") return GREEN_HEX;
  if (type === "stall") return GOLD_HEX;
  return BLUE_HEX;
}

// Customer-facing labels. Mirrors the admin dropdown: the DB enum
// stays kitchen|stall|partner_pickup, only the rendered strings
// change to match the operator's mental model.
function typeBadge(type: PickupLocationType): string {
  if (type === "kitchen") return "Store";
  if (type === "stall") return "Stall";
  return "Other Place";
}

type TabKey = "all" | PickupLocationType;

const MAP_CONTAINER_STYLE = { width: "100%", height: "100%" };

const MAP_OPTIONS: google.maps.MapOptions = {
  disableDefaultUI: false,
  zoomControl: true,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
  clickableIcons: false,
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

// Great-circle distance, kilometres. Sufficient within a single city.
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Open Google Maps directions for the given location. Lat/lng-based
// destination is the most reliable handoff because it doesn't depend
// on Google's reverse-geocoder picking the right address.
//
// When the admin captured a google_place_id at edit time we hand it
// off as `destination_place_id` — Google then resolves to that exact
// entity (entrance, business name, hours) rather than the nearest
// generic address to the lat/lng.
function navigateTo(loc: PickupLocationRow) {
  const ll = `${loc.latitude},${loc.longitude}`;
  const name = encodeURIComponent(`${loc.name}, ${loc.area}, Visakhapatnam`);
  const placeIdParam = loc.google_place_id
    ? `&destination_place_id=${encodeURIComponent(loc.google_place_id)}`
    : "";
  window.open(
    `https://www.google.com/maps/dir/?api=1&destination=${ll}${placeIdParam}&travelmode=driving&query=${name}`,
    "_blank",
    "noopener,noreferrer",
  );
}

type CheckResult =
  | { kind: "served"; areaNames: string[] }
  | { kind: "unserved" }
  | { kind: "error"; message: string };

export default function FindUsClient({
  apiKey,
  locations,
}: {
  apiKey: string;
  locations: PickupLocationRow[];
}) {
  const { isLoaded } = useJsApiLoader({
    id: GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: apiKey,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");
  const [pincode, setPincode] = useState("");
  const [pincodeResult, setPincodeResult] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(
    null,
  );

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

  const counts = useMemo(() => {
    const c = { all: locations.length, kitchen: 0, stall: 0, partner_pickup: 0 };
    for (const l of locations) c[l.type] += 1;
    return c;
  }, [locations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return locations.filter((loc) => {
      if (activeTab !== "all" && loc.type !== activeTab) return false;
      if (!q) return true;
      return (
        loc.name.toLowerCase().includes(q) ||
        loc.area.toLowerCase().includes(q) ||
        loc.address.toLowerCase().includes(q) ||
        (loc.pincode?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [activeTab, search, locations]);

  const selected = useMemo(
    () => locations.find((l) => l.id === selectedId) ?? null,
    [selectedId, locations],
  );

  async function checkPincode(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = pincode.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setPincodeResult({ kind: "error", message: "Enter a 6-digit pincode." });
      return;
    }
    setChecking(true);
    try {
      const r = await fetch(`/api/service-areas/check?pincode=${trimmed}`);
      const json: { serviceable?: boolean; area_names?: string[]; error?: string } =
        await r.json().catch(() => ({}));
      if (!r.ok) {
        setPincodeResult({
          kind: "error",
          message: json?.error ?? "Could not check that pincode.",
        });
      } else if (json.serviceable) {
        setPincodeResult({ kind: "served", areaNames: json.area_names ?? [] });
      } else {
        setPincodeResult({ kind: "unserved" });
      }
    } catch {
      setPincodeResult({ kind: "error", message: "Network error — try again." });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#C0C8CE",
        position: "relative",
        overflowX: "clip",
      }}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: "url(/grain.svg)",
          opacity: 0.04,
          mixBlendMode: "multiply",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

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
          color: "#024628",
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
        <h1
          style={{
            margin: "0 0 12px",
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(40px,9vw,76px)",
            fontWeight: 300,
            color: "#024628",
            letterSpacing: "0.02em",
            lineHeight: 1,
          }}
        >
          Store Locator
        </h1>
        <p
          style={{
            margin: "0 0 36px",
            fontFamily: "var(--font-body)",
            fontSize: 14,
            fontWeight: 300,
            color: "rgba(2,70,40,0.8)",
            letterSpacing: "0.02em",
            lineHeight: 1.6,
            maxWidth: 640,
          }}
        >
          {counts.all} pickup {counts.all === 1 ? "location" : "locations"} across
          Visakhapatnam. Tap any pin for directions, or check your pincode below.
        </p>

        <div
          style={{
            width: "100%",
            height: "clamp(300px, 50vh, 460px)",
            borderRadius: 12,
            overflow: "hidden",
            border: `0.5px solid rgba(${GOLD_RGB},0.35)`,
            background: "#024628",
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
              {filtered.map((loc) => (
                <Marker
                  key={loc.id}
                  position={{ lat: loc.latitude, lng: loc.longitude }}
                  onClick={() => setSelectedId(loc.id)}
                  icon={{
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: loc.type === "kitchen" ? 10 : 8,
                    fillColor: pinColorFor(loc.type),
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
                  <div style={{ color: "#1a1612", maxWidth: 240, padding: 4 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                      {selected.name}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 6 }}>
                      {typeBadge(selected.type)} · {selected.area}
                    </div>
                    <button
                      type="button"
                      onClick={() => navigateTo(selected)}
                      style={{
                        background: GREEN_HEX,
                        color: "#FBF3D4",
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

        {/* Legend */}
        <div
          style={{
            display: "flex",
            gap: 24,
            flexWrap: "wrap",
            marginBottom: 32,
            fontFamily: "var(--font-body)",
            fontSize: 11,
            color: "rgba(2,70,40,0.8)",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
          }}
        >
          <LegendDot color={GREEN_HEX} label={`Store (${counts.kitchen})`} />
          <LegendDot color={GOLD_HEX} label={`Stall (${counts.stall})`} />
          <LegendDot
            color={BLUE_HEX}
            label={`Other Place (${counts.partner_pickup})`}
          />
        </div>

        {/* Pincode checker */}
        <form
          onSubmit={checkPincode}
          style={{
            background: "#024628",
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
                background: "rgba(251,243,212,0.08)",
                border: "1px solid #FBF3D4",
                borderRadius: 8,
                padding: "12px 14px",
                color: "#FBF3D4",
                caretColor: "#FBF3D4",
                fontFamily: "var(--font-body)",
                fontSize: 14,
                outline: "none",
              }}
            />
          </div>
          <button
            type="submit"
            disabled={checking}
            className="cdx-locator-btn"
            style={{
              background: "transparent",
              border: "1px solid #FBF3D4",
              borderRadius: 8,
              padding: "12px 22px",
              fontFamily: "var(--font-body)",
              fontSize: 11,
              fontWeight: 400,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: "#FBF3D4",
              cursor: checking ? "wait" : "pointer",
              opacity: checking ? 0.6 : 1,
            }}
          >
            {checking ? "Checking…" : "Check"}
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
                    : pincodeResult.kind === "unserved"
                      ? "rgba(251,243,212,0.7)"
                      : "#fca5a5",
                lineHeight: 1.5,
              }}
            >
              {pincodeResult.kind === "served" ? (
                <>
                  ✓ Yes — Cadieux delivers to <strong>{pincode}</strong>
                  {pincodeResult.areaNames.length > 0 && (
                    <> ({pincodeResult.areaNames.join(", ")})</>
                  )}
                  .
                </>
              ) : pincodeResult.kind === "unserved" ? (
                <>Sorry — Cadieux doesn&apos;t deliver to that pincode yet.</>
              ) : (
                pincodeResult.message
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
          {(["all", "kitchen", "stall", "partner_pickup"] as TabKey[]).map(
            (key) => {
              const isActive = activeTab === key;
              const label =
                key === "all"
                  ? "All"
                  : key === "kitchen"
                    ? "Stores"
                    : key === "stall"
                      ? "Stalls"
                      : "Other Places";
              const count =
                key === "all"
                  ? counts.all
                  : key === "kitchen"
                    ? counts.kitchen
                    : key === "stall"
                      ? counts.stall
                      : counts.partner_pickup;
              return (
                <button
                  key={key}
                  role="tab"
                  type="button"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(key)}
                  style={{
                    background: isActive ? "#024628" : "transparent",
                    border: "1px solid #024628",
                    borderRadius: 999,
                    padding: "8px 16px",
                    fontFamily: "var(--font-body)",
                    fontSize: 11,
                    fontWeight: 400,
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    color: isActive ? "#FBF3D4" : "#024628",
                    cursor: "pointer",
                  }}
                >
                  {label}
                  <span style={{ marginLeft: 8, opacity: 0.7 }}>{count}</span>
                </button>
              );
            },
          )}
        </div>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, area, address or pincode…"
          aria-label="Search locations"
          style={{
            width: "100%",
            background: "#FBF3D4",
            border: "1px solid #024628",
            borderRadius: 12,
            padding: "14px 18px",
            color: "#024628",
            caretColor: "#024628",
            fontFamily: "var(--font-body)",
            fontSize: 14,
            fontWeight: 300,
            letterSpacing: "0.04em",
            outline: "none",
            marginBottom: 28,
          }}
        />

        {/* Card grid */}
        {filtered.length === 0 ? (
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 13,
              color: "rgba(2,70,40,0.7)",
              textAlign: "center",
              padding: "40px 0",
            }}
          >
            No locations match your filters.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 12,
            }}
          >
            {filtered.map((loc) => {
              const dist = userLoc
                ? haversineKm(userLoc.lat, userLoc.lng, loc.latitude, loc.longitude)
                : null;
              return (
                <article
                  key={loc.id}
                  style={{
                    background: "#024628",
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
                        color: "#FBF3D4",
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
                        color: pinColorFor(loc.type),
                        border: `0.5px solid ${pinColorFor(loc.type)}66`,
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
                      color: "rgba(251,243,212,0.75)",
                      letterSpacing: "0.03em",
                      lineHeight: 1.5,
                    }}
                  >
                    {loc.area}
                  </p>
                  {(loc.notes || dist !== null) && (
                    <p
                      style={{
                        margin: 0,
                        fontFamily: "var(--font-body)",
                        fontSize: 10,
                        fontWeight: 300,
                        color: "rgba(251,243,212,0.6)",
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
                        border: "1px solid #FBF3D4",
                        borderRadius: 6,
                        padding: "7px 14px",
                        fontFamily: "var(--font-body)",
                        fontSize: 10,
                        fontWeight: 400,
                        letterSpacing: "0.25em",
                        textTransform: "uppercase",
                        color: "#FBF3D4",
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
        )}

        {/* CTA */}
        <div
          style={{
            marginTop: 48,
            padding: "28px 24px",
            background: "#FBF3D4",
            border: "1px solid #024628",
            borderRadius: 12,
            textAlign: "center",
          }}
        >
          <h2
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 22,
              fontWeight: 400,
              color: "#024628",
              margin: "0 0 10px",
            }}
          >
            Don&apos;t see your area?
          </h2>
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 13,
              fontWeight: 300,
              color: "rgba(2,70,40,0.8)",
              margin: "0 0 16px",
              lineHeight: 1.6,
            }}
          >
            Tell us where you live — once a handful of neighbours sign up, we
            open up your gate.
          </p>
          <a
            href="mailto:hello@cadieux.in?subject=Suggest%20a%20location"
            style={{
              display: "inline-block",
              background: "#024628",
              border: "1px solid #024628",
              borderRadius: 8,
              padding: "12px 22px",
              fontFamily: "var(--font-body)",
              fontSize: 11,
              fontWeight: 400,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              color: "#FBF3D4",
              textDecoration: "none",
            }}
          >
            Suggest a location
          </a>
        </div>
      </div>

      <style>{`
        .cdx-locator-btn:hover {
          background: rgba(251,243,212,0.12) !important;
        }
        .cdx-locator-btn:focus-visible {
          outline: 2px solid #FBF3D4;
          outline-offset: 2px;
        }
        input::placeholder { color: rgba(2,70,40,0.4); }
        #cdx-pincode::placeholder { color: rgba(251,243,212,0.4); }
      `}</style>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: 6,
          background: color,
          border: "1px solid #000",
        }}
      />
      {label}
    </span>
  );
}
