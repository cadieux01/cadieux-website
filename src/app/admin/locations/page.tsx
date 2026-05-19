"use client";

// /admin/locations — CRUD for the pickup_locations table that powers
// the public Find Us pages on web + mobile. Reuses the AdminShell.
//
// Filter chips: All | Kitchen | Stall | Partner pickup | Archived.
// The Add/Edit modal embeds a Google Map with Places Autocomplete and
// a draggable marker — picking a place fills name+address+area+lat/lng
// in one click; dragging the marker updates the coords without
// touching the rest.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Autocomplete,
  GoogleMap,
  Marker,
  useJsApiLoader,
} from "@react-google-maps/api";

import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import {
  GOOGLE_MAPS_LIBRARIES,
  GOOGLE_MAPS_LOADER_ID,
} from "@/lib/google-maps-loader";

const GOLD = "#f59e0b";
const GOLD_SOFT = "rgba(245,158,11,0.85)";
const CREAM = "#fbf3d4";
const FADED = "rgba(192,200,206,0.6)";
const BORDER = "rgba(245,158,11,0.18)";

// Pin colours per type — matches /find-us legend.
const COLOR_KITCHEN = "#16a34a";
const COLOR_STALL = "#c9a96e";
const COLOR_PARTNER = "#3b82f6";

const VIZAG_CENTER = { lat: 17.74, lng: 83.3 };

type PickupType = "kitchen" | "stall" | "partner_pickup";

type LocationRow = {
  id: string;
  name: string;
  type: PickupType;
  area: string;
  address: string;
  latitude: number;
  longitude: number;
  notes: string | null;
  sort_order: number;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type FilterKey = "all" | PickupType | "archived";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "kitchen", label: "Kitchen" },
  { key: "stall", label: "Stall" },
  { key: "partner_pickup", label: "Partner pickup" },
  { key: "archived", label: "Archived" },
];

const TYPE_LABEL: Record<PickupType, string> = {
  kitchen: "Kitchen",
  stall: "Stall",
  partner_pickup: "Partner pickup",
};

function colorFor(type: PickupType): string {
  if (type === "kitchen") return COLOR_KITCHEN;
  if (type === "stall") return COLOR_STALL;
  return COLOR_PARTNER;
}

export default function AdminLocationsPage() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const { isLoaded } = useJsApiLoader({
    id: GOOGLE_MAPS_LOADER_ID,
    googleMapsApiKey: apiKey,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  const [rows, setRows] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [q, setQ] = useState("");

  const [editing, setEditing] = useState<LocationRow | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await adminFetch<{ locations: LocationRow[] }>(
        `/api/admin/locations?include_archived=1`,
      );
      setRows(res.locations ?? []);
    } catch (e) {
      setErr(
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Failed to load locations",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "archived") {
        if (!r.is_archived) return false;
      } else {
        if (r.is_archived) return false;
        if (filter !== "all" && r.type !== filter) return false;
      }
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        r.area.toLowerCase().includes(needle) ||
        r.address.toLowerCase().includes(needle)
      );
    });
  }, [rows, filter, q]);

  const subtitle = `${rows.filter((r) => !r.is_archived).length} active · ${
    rows.filter((r) => r.is_archived).length
  } archived`;

  async function handleArchive(row: LocationRow) {
    if (!confirm(`Archive "${row.name}"?`)) return;
    try {
      await adminFetch(`/api/admin/locations/${row.id}/archive`, {
        method: "POST",
      });
      await load();
    } catch (e) {
      alert(e instanceof AdminFetchError ? e.message : "Archive failed");
    }
  }

  async function handleUnarchive(row: LocationRow) {
    try {
      await adminFetch(`/api/admin/locations/${row.id}/unarchive`, {
        method: "POST",
      });
      await load();
    } catch (e) {
      alert(e instanceof AdminFetchError ? e.message : "Unarchive failed");
    }
  }

  return (
    <AdminShell
      title="Locations"
      subtitle={subtitle}
      actions={
        <>
          <button
            type="button"
            onClick={() => void load()}
            className="uppercase"
            style={refreshBtn}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="uppercase"
            style={{ ...refreshBtn, color: CREAM, background: GOLD, borderColor: GOLD }}
          >
            + Add location
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className="uppercase"
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "0.62rem",
                  letterSpacing: "0.2em",
                  padding: "0.3rem 0.7rem",
                  color: active ? "#06120c" : GOLD_SOFT,
                  background: active ? GOLD : "transparent",
                  border: `1px solid ${active ? GOLD : "rgba(245,158,11,0.4)"}`,
                  cursor: "pointer",
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, area, or address…"
          className="px-3 py-2"
          style={{
            border: `1px solid ${BORDER}`,
            background: "transparent",
            color: CREAM,
            fontFamily: "var(--font-body)",
            fontSize: "0.85rem",
            minWidth: "260px",
            maxWidth: "420px",
          }}
        />

        {err ? (
          <div
            role="alert"
            style={{
              border: "1px solid rgba(239,68,68,0.55)",
              background: "rgba(239,68,68,0.08)",
              padding: "0.75rem 1rem",
              color: "#fecaca",
              fontFamily: "var(--font-body)",
              fontSize: "0.85rem",
              lineHeight: 1.5,
            }}
          >
            {err}
          </div>
        ) : null}

        <div
          style={{
            border: `1px solid ${BORDER}`,
            background: "rgba(0,0,0,0.18)",
          }}
        >
          <div className="overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontFamily: "var(--font-body)",
                color: CREAM,
                fontSize: "0.82rem",
                minWidth: 720,
              }}
            >
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    color: GOLD_SOFT,
                    fontSize: "0.62rem",
                    letterSpacing: "0.22em",
                    textTransform: "uppercase",
                  }}
                >
                  <th style={th}>Name</th>
                  <th style={th}>Type</th>
                  <th style={th}>Area</th>
                  <th style={th}>Coords</th>
                  <th style={th}>Sort</th>
                  <th style={{ ...th, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} style={{ ...td, color: FADED }}>
                      Loading…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ ...td, color: FADED }}>
                      No locations match the current filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr
                      key={r.id}
                      style={{ borderTop: `1px solid ${BORDER}` }}
                    >
                      <td style={td}>
                        <div style={{ color: CREAM, display: "flex", alignItems: "center", gap: 8 }}>
                          <span
                            style={{
                              display: "inline-block",
                              width: 10,
                              height: 10,
                              borderRadius: 5,
                              background: colorFor(r.type),
                              border: "1px solid #000",
                              flexShrink: 0,
                            }}
                          />
                          {r.name}
                        </div>
                        {r.is_archived ? (
                          <div
                            style={{
                              color: "rgba(239,68,68,0.85)",
                              fontSize: "0.65rem",
                              letterSpacing: "0.2em",
                              textTransform: "uppercase",
                              marginTop: 2,
                            }}
                          >
                            Archived
                          </div>
                        ) : null}
                      </td>
                      <td style={td}>{TYPE_LABEL[r.type]}</td>
                      <td style={td}>{r.area}</td>
                      <td style={{ ...td, color: FADED, fontSize: "0.72rem" }}>
                        {r.latitude.toFixed(5)}, {r.longitude.toFixed(5)}
                      </td>
                      <td style={td}>{r.sort_order}</td>
                      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          onClick={() => setEditing(r)}
                          className="uppercase"
                          style={miniBtn}
                        >
                          Edit
                        </button>
                        {r.is_archived ? (
                          <button
                            type="button"
                            onClick={() => void handleUnarchive(r)}
                            className="uppercase"
                            style={{ ...miniBtn, marginLeft: 6 }}
                          >
                            Restore
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleArchive(r)}
                            className="uppercase"
                            style={{
                              ...miniBtn,
                              marginLeft: 6,
                              color: "rgba(239,68,68,0.9)",
                              borderColor: "rgba(239,68,68,0.45)",
                            }}
                          >
                            Archive
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {(editing || creating) && isLoaded ? (
        <LocationModal
          initial={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            void load();
          }}
        />
      ) : null}
      {(editing || creating) && !isLoaded ? (
        <div
          role="alert"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            zIndex: 500,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: FADED,
            fontFamily: "var(--font-body)",
            fontSize: "0.85rem",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
          }}
          onClick={() => {
            setEditing(null);
            setCreating(false);
          }}
        >
          Loading map…
        </div>
      ) : null}
    </AdminShell>
  );
}

// ─── Modal ──────────────────────────────────────────────────────────

function LocationModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: LocationRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<PickupType>(initial?.type ?? "stall");
  const [area, setArea] = useState(initial?.area ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [lat, setLat] = useState<number>(initial?.latitude ?? VIZAG_CENTER.lat);
  const [lng, setLng] = useState<number>(initial?.longitude ?? VIZAG_CENTER.lng);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [sortOrder, setSortOrder] = useState<string>(
    initial?.sort_order != null ? String(initial.sort_order) : "",
  );

  const [autocomplete, setAutocomplete] =
    useState<google.maps.places.Autocomplete | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // When the operator picks a place from Autocomplete, harvest the bits
  // we care about. Falls back to vicinity for area if there are no
  // address_components (rare but possible for plus-codes).
  const onPlaceChanged = useCallback(() => {
    if (!autocomplete) return;
    const place = autocomplete.getPlace();
    const loc = place.geometry?.location;
    if (loc) {
      setLat(loc.lat());
      setLng(loc.lng());
    }
    if (place.name) setName((cur) => cur || place.name!);
    if (place.formatted_address) setAddress(place.formatted_address);

    // Derive a short "area" string: try sublocality_level_1 first,
    // then locality, then vicinity. Keeps the public card subtitle
    // human-friendly without forcing the operator to retype.
    const comps = place.address_components ?? [];
    const pick = (t: string) =>
      comps.find((c) => c.types.includes(t))?.long_name;
    const derivedArea =
      pick("sublocality_level_1") ??
      pick("sublocality") ??
      pick("neighborhood") ??
      pick("locality") ??
      place.vicinity ??
      "";
    if (derivedArea) setArea(derivedArea);
  }, [autocomplete]);

  async function handleSave() {
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        name: name.trim(),
        type,
        area: area.trim(),
        address: address.trim(),
        latitude: lat,
        longitude: lng,
        notes: notes.trim() ? notes.trim() : null,
        ...(sortOrder.trim() !== "" && Number.isFinite(Number(sortOrder))
          ? { sort_order: Number(sortOrder) }
          : {}),
      };
      if (initial) {
        await adminFetch(`/api/admin/locations/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await adminFetch(`/api/admin/locations`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof AdminFetchError ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.78)",
        zIndex: 500,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        overflowY: "auto",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 100%)",
          background: "rgb(6,4,2)",
          border: `1px solid ${BORDER}`,
          padding: "1.25rem 1.25rem 1.5rem",
          maxHeight: "calc(100dvh - 2rem)",
          overflowY: "auto",
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3
            className="uppercase"
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 300,
              color: CREAM,
              fontSize: "1.1rem",
              letterSpacing: "0.18em",
              margin: 0,
            }}
          >
            {initial ? "Edit location" : "New location"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="uppercase"
            style={{
              ...miniBtn,
              color: FADED,
              borderColor: BORDER,
            }}
          >
            Close
          </button>
        </div>

        {/* Places Autocomplete */}
        <div style={{ marginBottom: "0.85rem" }}>
          <Label>Search Google Maps</Label>
          <Autocomplete
            onLoad={(ac) => setAutocomplete(ac)}
            onPlaceChanged={onPlaceChanged}
            options={{
              componentRestrictions: { country: "in" },
              fields: [
                "name",
                "formatted_address",
                "geometry",
                "address_components",
                "vicinity",
              ],
            }}
          >
            <input
              type="text"
              placeholder="Start typing a place name or address…"
              style={textInput}
            />
          </Autocomplete>
        </div>

        {/* Map with draggable marker */}
        <div
          style={{
            width: "100%",
            height: 260,
            border: `1px solid ${BORDER}`,
            marginBottom: "0.85rem",
          }}
        >
          <GoogleMap
            mapContainerStyle={{ width: "100%", height: "100%" }}
            center={{ lat, lng }}
            zoom={14}
            options={{
              disableDefaultUI: true,
              zoomControl: true,
              clickableIcons: false,
            }}
          >
            <Marker
              position={{ lat, lng }}
              draggable
              onDragEnd={(e) => {
                if (e.latLng) {
                  setLat(e.latLng.lat());
                  setLng(e.latLng.lng());
                }
              }}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                scale: 9,
                fillColor: colorFor(type),
                fillOpacity: 0.95,
                strokeColor: "#000",
                strokeWeight: 1,
              }}
            />
          </GoogleMap>
        </div>

        <FormGrid>
          <div>
            <Label>Name</Label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={textInput}
            />
          </div>
          <div>
            <Label>Type</Label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as PickupType)}
              style={{ ...textInput, paddingRight: "2rem" }}
            >
              <option value="kitchen">Kitchen</option>
              <option value="stall">Stall</option>
              <option value="partner_pickup">Partner pickup</option>
            </select>
          </div>
          <div>
            <Label>Area</Label>
            <input
              type="text"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              style={textInput}
            />
          </div>
          <div>
            <Label>Sort order</Label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              placeholder="auto"
              style={textInput}
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <Label>Address</Label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              style={textInput}
            />
          </div>
          <div>
            <Label>Latitude</Label>
            <input
              type="number"
              step="0.0000001"
              value={lat}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setLat(n);
              }}
              style={textInput}
            />
          </div>
          <div>
            <Label>Longitude</Label>
            <input
              type="number"
              step="0.0000001"
              value={lng}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setLng(n);
              }}
              style={textInput}
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <Label>Notes (optional)</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={{ ...textInput, resize: "vertical" }}
            />
          </div>
        </FormGrid>

        {err ? (
          <p
            style={{
              color: "#fca5a5",
              fontFamily: "var(--font-body)",
              fontSize: "0.78rem",
              marginTop: "0.75rem",
            }}
          >
            {err}
          </p>
        ) : null}

        <div className="flex gap-2 justify-end" style={{ marginTop: "1rem" }}>
          <button
            type="button"
            onClick={onClose}
            className="uppercase"
            style={{ ...miniBtn, color: FADED, borderColor: BORDER }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="uppercase"
            style={{
              ...miniBtn,
              color: "#06120c",
              background: GOLD,
              borderColor: GOLD,
              opacity: saving ? 0.6 : 1,
              cursor: saving ? "wait" : "pointer",
            }}
          >
            {saving ? "Saving…" : initial ? "Save changes" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label
      className="uppercase"
      style={{
        display: "block",
        fontFamily: "var(--font-body)",
        fontSize: "0.6rem",
        letterSpacing: "0.22em",
        color: FADED,
        marginBottom: "0.3rem",
      }}
    >
      {children}
    </label>
  );
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0,1fr))",
        gap: "0.8rem 0.8rem",
      }}
    >
      {children}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "0.65rem 0.85rem",
  fontWeight: 400,
  borderBottom: `1px solid ${BORDER}`,
};
const td: React.CSSProperties = {
  padding: "0.7rem 0.85rem",
  verticalAlign: "top",
};
const refreshBtn: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.7rem",
  letterSpacing: "0.25em",
  color: GOLD,
  border: `1px solid ${GOLD}`,
  padding: "0.45rem 0.9rem",
  background: "transparent",
  cursor: "pointer",
};
const miniBtn: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.62rem",
  letterSpacing: "0.22em",
  color: GOLD_SOFT,
  border: `1px solid rgba(245,158,11,0.4)`,
  padding: "0.32rem 0.7rem",
  background: "transparent",
  cursor: "pointer",
};
const textInput: React.CSSProperties = {
  width: "100%",
  padding: "0.55rem 0.7rem",
  border: `1px solid ${BORDER}`,
  background: "transparent",
  color: CREAM,
  fontFamily: "var(--font-body)",
  fontSize: "0.85rem",
};
