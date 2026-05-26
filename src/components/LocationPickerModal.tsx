"use client";

// WhatsApp-style interactive location picker for checkout.
//
// Renders a modal with a draggable pin on a Google Map, a Places search bar,
// and a "Confirm location" CTA. Picks GPS as the initial centre when the
// browser grants permission; otherwise falls back to Visakhapatnam centre
// and lets the user search / drag the pin manually.
//
// Reuses the shared GOOGLE_MAPS_LOADER_ID singleton so it doesn't conflict
// with the Autocomplete-only loader inside the address form.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Autocomplete,
  GoogleMap,
  Marker,
  useJsApiLoader,
} from "@react-google-maps/api";
import {
  GOOGLE_MAPS_LIBRARIES,
  GOOGLE_MAPS_LOADER_ID,
} from "@/lib/google-maps-loader";
import { reverseGeocodeClient } from "@/lib/clientGeocode";

// Visakhapatnam city centre — used when GPS permission is denied or the
// browser doesn't expose geolocation. Customers can still drag the pin or
// search; this just gives the map something to render.
const FALLBACK_CENTER = { lat: 17.6868, lng: 83.2185 };

type PickedAddress = {
  line1: string;
  area: string;
  city: string;
  pincode: string;
  lat: number;
  lng: number;
};

export default function LocationPickerModal(props: {
  onClose: () => void;
  onConfirm: (result: PickedAddress) => void;
}) {
  const { onClose, onConfirm } = props;

  // Reuse the singleton loader so we don't re-init the JS SDK. The hook is
  // idempotent against identical id/libraries — different options would throw.
  const { isLoaded } = useJsApiLoader({
    id: GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  const [center, setCenter] = useState<{ lat: number; lng: number }>(FALLBACK_CENTER);
  const [pin, setPin] = useState<{ lat: number; lng: number }>(FALLBACK_CENTER);
  const [resolving, setResolving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const mapRef = useRef<google.maps.Map | null>(null);
  const acRef = useRef<google.maps.places.Autocomplete | null>(null);

  // Try GPS once on open — if granted, centre on the device location. If
  // denied, leave the pin at the fallback centre with a helpful note.
  useEffect(() => {
    if (!navigator.geolocation) {
      setErrMsg("Geolocation isn't available — drag the pin or search instead.");
      return;
    }
    setResolving(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCenter(next);
        setPin(next);
        setResolving(false);
      },
      (err) => {
        setResolving(false);
        if (err.code === err.PERMISSION_DENIED) {
          setErrMsg("Location permission denied. Drag the pin or search to set your delivery point.");
        } else {
          setErrMsg("Couldn't fetch your GPS. Drag the pin or search instead.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  // Lock body scroll while the modal is open so background pages don't drift
  // under the user's finger while they pan the map.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return;
    setPin({ lat: e.latLng.lat(), lng: e.latLng.lng() });
  }, []);

  const handleMarkerDragEnd = useCallback((e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return;
    setPin({ lat: e.latLng.lat(), lng: e.latLng.lng() });
  }, []);

  const handlePlaceChanged = useCallback(() => {
    const place = acRef.current?.getPlace();
    const loc = place?.geometry?.location;
    if (!loc) return;
    const next = { lat: loc.lat(), lng: loc.lng() };
    setCenter(next);
    setPin(next);
    mapRef.current?.panTo(next);
  }, []);

  const handleConfirm = useCallback(async () => {
    setConfirming(true);
    setErrMsg(null);
    const result = await reverseGeocodeClient(pin.lat, pin.lng);
    setConfirming(false);
    if (!result) {
      setErrMsg("Couldn't read an address from this point. Move the pin slightly and try again.");
      return;
    }
    onConfirm(result);
  }, [pin.lat, pin.lng, onConfirm]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(8,6,4,0.78)",
        backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "calc(20px + env(safe-area-inset-top)) 16px calc(20px + env(safe-area-inset-bottom))",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "100%", maxWidth: 560,
          maxHeight: "100%",
          display: "flex", flexDirection: "column",
          background: "#141210",
          border: "1px solid rgba(200,144,58,0.35)",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid rgba(200,144,58,0.18)" }}>
          <span style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(240,223,200,0.8)" }}>
            Pick delivery location
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 20, lineHeight: 1, color: "rgba(240,223,200,0.65)",
              padding: 4, WebkitTapHighlightColor: "transparent",
            }}
          >
            ×
          </button>
        </div>

        {/* Search bar */}
        <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(200,144,58,0.12)" }}>
          {isLoaded ? (
            <Autocomplete
              onLoad={(ac) => { acRef.current = ac; }}
              onPlaceChanged={handlePlaceChanged}
              options={{
                componentRestrictions: { country: "in" },
                fields: ["geometry", "formatted_address"],
                types: ["geocode", "establishment"],
              }}
            >
              <input
                type="text"
                placeholder="Search a building, landmark or area"
                autoComplete="off"
                style={{
                  width: "100%", height: 42,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(200,144,58,0.3)",
                  outline: "none",
                  padding: "0 14px",
                  fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200,
                  color: "#FBF3D4",
                  letterSpacing: "0.03em",
                }}
              />
            </Autocomplete>
          ) : (
            <div
              style={{
                width: "100%", height: 42,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(200,144,58,0.18)",
                display: "flex", alignItems: "center",
                padding: "0 14px",
                fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200,
                color: "rgba(240,223,200,0.45)",
              }}
            >
              Loading map…
            </div>
          )}
        </div>

        {/* Map */}
        <div style={{ flex: 1, minHeight: 320, position: "relative", background: "#1a1816" }}>
          {isLoaded ? (
            <GoogleMap
              mapContainerStyle={{ width: "100%", height: "100%", minHeight: 320 }}
              center={center}
              zoom={16}
              onClick={handleMapClick}
              onLoad={(map) => { mapRef.current = map; }}
              options={{
                disableDefaultUI: true,
                zoomControl: true,
                gestureHandling: "greedy",
                clickableIcons: false,
              }}
            >
              <Marker
                position={pin}
                draggable
                onDragEnd={handleMarkerDragEnd}
              />
            </GoogleMap>
          ) : (
            <div style={{ height: 320, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(240,223,200,0.5)", fontFamily: "var(--font-body)", fontSize: 12, letterSpacing: "0.04em" }}>
              {resolving ? "Detecting your location…" : "Loading map…"}
            </div>
          )}
        </div>

        {/* Status + Confirm */}
        <div style={{ padding: "14px 18px", borderTop: "1px solid rgba(200,144,58,0.18)" }}>
          {errMsg && (
            <p style={{ margin: "0 0 10px", fontFamily: "var(--font-body)", fontSize: 12, color: "#e09a5a", letterSpacing: "0.03em", lineHeight: 1.5 }}>
              {errMsg}
            </p>
          )}

          <p style={{ margin: "0 0 12px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, color: "rgba(240,223,200,0.55)", letterSpacing: "0.03em", lineHeight: 1.5 }}>
            Drag the pin or search to fine-tune. We'll fill the address from this point.
          </p>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirming || !isLoaded}
            style={{
              display: "block", width: "100%", height: 48,
              background: (confirming || !isLoaded) ? "rgba(240,223,200,0.12)" : "#f0dfc8",
              border: "none",
              cursor: (confirming || !isLoaded) ? "default" : "pointer",
              fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
              letterSpacing: "0.4em", textTransform: "uppercase",
              color: (confirming || !isLoaded) ? "rgba(8,6,4,0.35)" : "#080604",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {confirming ? "Confirming…" : "Confirm Location"}
          </button>
        </div>
      </div>
    </div>
  );
}
