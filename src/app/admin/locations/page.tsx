"use client";

// /admin/locations — CRUD for the pickup_locations table that powers
// the public /find-us (Store Locator) on web + mobile. Reuses the
// AdminShell.
//
// Tabs: Active | Archived | All (mirrors /admin/service-areas).
// The Add/Edit modal embeds a Google Map with Places Autocomplete and
// a draggable marker — picking a place fills name+address+area+lat/lng
// in one click; dragging the marker updates the coords without
// touching the rest.
//
// Bulk operations: tick rows → sticky action bar offers Archive N
// (gold), Delete N (red, requires typing "DELETE" to confirm), and
// Edit (enabled only when exactly one row is ticked). All three
// share POST /api/admin/locations/bulk, which logs a single audit
// row per bulk action.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Autocomplete,
  GoogleMap,
  Marker,
  useJsApiLoader,
} from "@react-google-maps/api";

import { AdminShell } from "@/components/admin/AdminShell";
import Select from "@/components/ui/Select";
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
const DANGER = "#ef4444";

// Pin colours per type — matches /find-us legend.
const COLOR_KITCHEN = "#16a34a";
const COLOR_STALL = "#024628";
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
  pincode: string | null;
  google_place_id: string | null;
  sort_order: number;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type TabKey = "active" | "archived" | "all";

const TABS: { key: TabKey; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
];

// Customer-facing labels. The DB enum values (kitchen | stall |
// partner_pickup) stay as-is to avoid a migration; only the display
// strings change to match the operator's mental model.
const TYPE_LABEL: Record<PickupType, string> = {
  kitchen: "Store",
  stall: "Stall",
  partner_pickup: "Other Place",
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
  const [tab, setTab] = useState<TabKey>("active");
  const [q, setQ] = useState("");

  const [editing, setEditing] = useState<LocationRow | null>(null);
  const [creating, setCreating] = useState(false);

  // Bulk selection state.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<null | "archive" | "delete">(
    null,
  );
  const [deleteText, setDeleteText] = useState("");

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

  // Clear selection when the visible set changes (tab switch / refresh).
  useEffect(() => {
    setSelected(new Set());
  }, [tab]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === "active" && r.is_archived) return false;
      if (tab === "archived" && !r.is_archived) return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        r.area.toLowerCase().includes(needle) ||
        r.address.toLowerCase().includes(needle)
      );
    });
  }, [rows, tab, q]);

  const visibleIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected =
    !allVisibleSelected && visibleIds.some((id) => selected.has(id));

  const toggleAllVisible = () => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  async function runBulk(action: "archive" | "unarchive" | "delete") {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await adminFetch<{
        ok: boolean;
        succeeded: string[];
        failed: string[];
      }>(`/api/admin/locations/bulk`, {
        method: "POST",
        body: JSON.stringify({ action, ids }),
      });
      if (res.failed.length > 0) {
        alert(
          `${res.succeeded.length} ${action}d, ${res.failed.length} skipped (not found).`,
        );
      }
      setBulkConfirm(null);
      setDeleteText("");
      setSelected(new Set());
      await load();
    } catch (e) {
      alert(e instanceof AdminFetchError ? e.message : `Bulk ${action} failed`);
    } finally {
      setBulkBusy(false);
    }
  }

  const selectionCount = selected.size;
  const onlyOneSelected = selectionCount === 1;
  const editSelected = () => {
    if (!onlyOneSelected) return;
    const id = Array.from(selected)[0];
    const row = rows.find((r) => r.id === id);
    if (row) setEditing(row);
  };

  return (
    <AdminShell
      title="Store Locator"
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
      <div
        className="flex flex-col gap-4"
        style={{ marginBottom: selectionCount > 0 ? 96 : 0 }}
      >
        {/* Tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          {TABS.map((t) => {
            const active = tab === t.key;
            const count =
              t.key === "active"
                ? rows.filter((r) => !r.is_archived).length
                : t.key === "archived"
                  ? rows.filter((r) => r.is_archived).length
                  : rows.length;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className="uppercase"
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "0.875rem",
                  letterSpacing: "0.2em",
                  padding: "0.3rem 0.7rem",
                  color: active ? "#06120c" : GOLD_SOFT,
                  background: active ? GOLD : "transparent",
                  border: `1px solid ${active ? GOLD : "rgba(245,158,11,0.4)"}`,
                  cursor: "pointer",
                }}
              >
                {t.label}
                <span style={{ marginLeft: 8, opacity: 0.7 }}>{count}</span>
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
            fontSize: "1rem",
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
              fontSize: "1rem",
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
                fontSize: "1rem",
                minWidth: 760,
              }}
            >
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    color: GOLD_SOFT,
                    fontSize: "0.875rem",
                    letterSpacing: "0.22em",
                    textTransform: "uppercase",
                  }}
                >
                  <th style={{ ...th, width: 36 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all visible"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someVisibleSelected;
                      }}
                      onChange={toggleAllVisible}
                      disabled={visibleIds.length === 0}
                    />
                  </th>
                  {/* Serial number — purely visual row counter for the
                      current filtered view; sort_order stays in the DB
                      and is editable via the modal but no longer shown
                      as a column. */}
                  <th style={{ ...th, width: 48 }}>S.No</th>
                  <th style={th}>Name</th>
                  <th style={th}>Type</th>
                  <th style={th}>Area</th>
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
                  filtered.map((r, idx) => {
                    const isSel = selected.has(r.id);
                    return (
                      <tr
                        key={r.id}
                        style={{
                          borderTop: `1px solid ${BORDER}`,
                          background: isSel
                            ? "rgba(245,158,11,0.06)"
                            : undefined,
                        }}
                      >
                        <td style={td}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.name}`}
                            checked={isSel}
                            onChange={() => toggleOne(r.id)}
                          />
                        </td>
                        <td style={{ ...td, color: FADED, fontVariantNumeric: "tabular-nums" }}>
                          {idx + 1}
                        </td>
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
                                fontSize: "0.875rem",
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
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Sticky bulk action bar */}
      {selectionCount > 0 ? (
        <div
          role="region"
          aria-label="Bulk actions"
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 400,
            background: "rgba(29,29,31,0.96)",
            borderTop: `1px solid ${BORDER}`,
            padding: "0.75rem 1.25rem",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            backdropFilter: "blur(6px)",
          }}
        >
          <div
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.875rem",
              letterSpacing: "0.22em",
              color: CREAM,
            }}
          >
            {selectionCount} selected
          </div>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="uppercase"
            style={{ ...miniBtn, color: FADED, borderColor: BORDER }}
          >
            Clear
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={editSelected}
            disabled={!onlyOneSelected || bulkBusy}
            className="uppercase"
            title={
              onlyOneSelected ? "Edit selected" : "Select exactly one row to edit"
            }
            style={{
              ...miniBtn,
              opacity: onlyOneSelected ? 1 : 0.4,
              cursor: onlyOneSelected ? "pointer" : "not-allowed",
            }}
          >
            Edit selected
          </button>
          {tab !== "active" ? (
            <button
              type="button"
              onClick={() => void runBulk("unarchive")}
              disabled={bulkBusy}
              className="uppercase"
              style={{ ...miniBtn, opacity: bulkBusy ? 0.5 : 1 }}
            >
              Restore {selectionCount}
            </button>
          ) : null}
          {tab !== "archived" ? (
            <button
              type="button"
              onClick={() => setBulkConfirm("archive")}
              disabled={bulkBusy}
              className="uppercase"
              style={{
                ...miniBtn,
                color: "#06120c",
                background: GOLD,
                borderColor: GOLD,
                opacity: bulkBusy ? 0.5 : 1,
              }}
            >
              Archive {selectionCount}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setDeleteText("");
              setBulkConfirm("delete");
            }}
            disabled={bulkBusy}
            className="uppercase"
            style={{
              ...miniBtn,
              color: "#fff",
              background: DANGER,
              borderColor: DANGER,
              opacity: bulkBusy ? 0.5 : 1,
            }}
          >
            Delete {selectionCount}
          </button>
        </div>
      ) : null}

      {/* Bulk archive confirmation */}
      {bulkConfirm === "archive" ? (
        <ConfirmModal
          onClose={() => setBulkConfirm(null)}
          title={`Archive ${selectionCount} location${selectionCount === 1 ? "" : "s"}?`}
          message={`They'll be hidden from /find-us and the app, kept for history.`}
          confirmLabel={bulkBusy ? "Archiving…" : `Archive ${selectionCount}`}
          confirmStyle={{ background: GOLD, borderColor: GOLD, color: "#06120c" }}
          confirmDisabled={bulkBusy}
          onConfirm={() => void runBulk("archive")}
        />
      ) : null}

      {/* Bulk delete confirmation — type-to-confirm */}
      {bulkConfirm === "delete" ? (
        <ConfirmModal
          onClose={() => {
            setBulkConfirm(null);
            setDeleteText("");
          }}
          title={`Permanently delete ${selectionCount} location${selectionCount === 1 ? "" : "s"}?`}
          message={`This cannot be undone. Type DELETE in capitals to confirm.`}
          confirmLabel={bulkBusy ? "Deleting…" : `Delete ${selectionCount}`}
          confirmStyle={{ background: DANGER, borderColor: DANGER, color: "#fff" }}
          confirmDisabled={bulkBusy || deleteText !== "DELETE"}
          onConfirm={() => void runBulk("delete")}
        >
          <input
            type="text"
            autoFocus
            value={deleteText}
            onChange={(e) => setDeleteText(e.target.value)}
            placeholder="Type DELETE"
            style={{ ...textInput, marginTop: "0.75rem" }}
          />
        </ConfirmModal>
      ) : null}

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
            fontSize: "0.875rem",
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

// ─── Confirm Modal ──────────────────────────────────────────────────

function ConfirmModal({
  title,
  message,
  confirmLabel,
  confirmStyle,
  confirmDisabled,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  confirmStyle?: React.CSSProperties;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.78)",
        zIndex: 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(460px, 100%)",
          background: "rgb(6,4,2)",
          border: `1px solid ${BORDER}`,
          // 3-zone scrollable layout
          display: "flex",
          flexDirection: "column",
          maxHeight: "min(90vh, calc(100dvh - 2rem))",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flexShrink: 0,
            padding: "1.1rem 1.25rem 0.9rem",
            background: "rgb(6,4,2)",
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          <h3
            className="uppercase"
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 300,
              color: CREAM,
              fontSize: "1.05rem",
              letterSpacing: "0.16em",
              margin: 0,
            }}
          >
            {title}
          </h3>
        </div>
        <div
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            padding: "1.1rem 1.25rem",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "1rem",
              color: FADED,
              lineHeight: 1.55,
              margin: 0,
            }}
          >
            {message}
          </p>
          {children}
        </div>
        <div
          style={{
            flexShrink: 0,
            padding: "0.9rem 1.25rem",
            background: "rgb(6,4,2)",
            borderTop: `1px solid ${BORDER}`,
          }}
        >
          <div className="flex gap-2 justify-end">
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
              onClick={onConfirm}
              disabled={confirmDisabled}
              className="uppercase"
              style={{
                ...miniBtn,
                ...confirmStyle,
                opacity: confirmDisabled ? 0.5 : 1,
                cursor: confirmDisabled ? "not-allowed" : "pointer",
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
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
  const [pincode, setPincode] = useState(initial?.pincode ?? "");
  const [googlePlaceId, setGooglePlaceId] = useState(
    initial?.google_place_id ?? "",
  );
  const [sortOrder, setSortOrder] = useState<string>(
    initial?.sort_order != null ? String(initial.sort_order) : "",
  );
  // Track whether the pin has been explicitly placed (search or drag)
  // so the "Pin set at" hint only appears after operator confirmation.
  const [pinTouched, setPinTouched] = useState<boolean>(initial != null);
  const [geocoding, setGeocoding] = useState(false);

  const [autocomplete, setAutocomplete] =
    useState<google.maps.places.Autocomplete | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Pick a component value by Google's `types` taxonomy.
  function pickComponent(
    comps: google.maps.GeocoderAddressComponent[] | undefined,
    type: string,
  ): string | undefined {
    return comps?.find((c) => c.types.includes(type))?.long_name;
  }

  // Reverse-geocode the dropped pin → fill address/area/pincode that
  // the operator can still edit. Only fires on dragEnd (not every
  // pixel of the drag) to keep Geocoding API spend bounded.
  const reverseGeocode = useCallback((latitude: number, longitude: number) => {
    if (typeof google === "undefined" || !google.maps) return;
    setGeocoding(true);
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode(
      { location: { lat: latitude, lng: longitude } },
      (results, status) => {
        setGeocoding(false);
        if (status !== "OK" || !results || results.length === 0) return;
        // Pick the most specific street-address-like result first;
        // otherwise fall back to results[0].
        const best =
          results.find((r) => r.types.includes("street_address")) ??
          results.find((r) => r.types.includes("premise")) ??
          results[0];
        if (!best) return;
        const comps = best.address_components;
        const derivedAddress = best.formatted_address;
        const derivedArea =
          pickComponent(comps, "sublocality_level_1") ??
          pickComponent(comps, "sublocality") ??
          pickComponent(comps, "neighborhood") ??
          pickComponent(comps, "locality");
        const derivedPincode = pickComponent(comps, "postal_code");
        if (derivedAddress) setAddress(derivedAddress);
        if (derivedArea) setArea(derivedArea);
        if (derivedPincode && /^\d{6}$/.test(derivedPincode)) {
          setPincode(derivedPincode);
        }
        if (best.place_id) setGooglePlaceId(best.place_id);
      },
    );
  }, []);

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
      setPinTouched(true);
    }
    if (place.name) setName((cur) => cur || place.name!);
    if (place.formatted_address) setAddress(place.formatted_address);
    if (place.place_id) setGooglePlaceId(place.place_id);

    // Derive a short "area" string: try sublocality_level_1 first,
    // then locality, then vicinity. Keeps the public card subtitle
    // human-friendly without forcing the operator to retype.
    const comps = place.address_components ?? [];
    const derivedArea =
      pickComponent(comps, "sublocality_level_1") ??
      pickComponent(comps, "sublocality") ??
      pickComponent(comps, "neighborhood") ??
      pickComponent(comps, "locality") ??
      place.vicinity ??
      "";
    if (derivedArea) setArea(derivedArea);

    const derivedPincode = pickComponent(comps, "postal_code");
    if (derivedPincode && /^\d{6}$/.test(derivedPincode)) {
      setPincode(derivedPincode);
    }
  }, [autocomplete]);

  async function handleSave() {
    setSaving(true);
    setErr(null);
    try {
      const trimmedPincode = pincode.trim();
      const payload = {
        name: name.trim(),
        type,
        area: area.trim(),
        address: address.trim(),
        latitude: lat,
        longitude: lng,
        notes: notes.trim() ? notes.trim() : null,
        pincode: trimmedPincode === "" ? null : trimmedPincode,
        google_place_id: googlePlaceId.trim() === "" ? null : googlePlaceId.trim(),
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
      }}
      onClick={onClose}
    >
      {/* Flex-column shell: header + scrolling body + footer. The body
          is the only thing that scrolls, so Save/Cancel stay reachable
          on phone-sized viewports where the map + form together are
          taller than the screen. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 100%)",
          background: "rgb(6,4,2)",
          border: `1px solid ${BORDER}`,
          maxHeight: "calc(100dvh - 2rem)",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        {/* Sticky header */}
        <div
          className="flex items-center justify-between"
          style={{
            flexShrink: 0,
            padding: "1.1rem 1.25rem",
            borderBottom: `1px solid ${BORDER}`,
            background: "rgb(6,4,2)",
          }}
        >
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

        {/* Scrollable body */}
        <div
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            padding: "1.1rem 1.25rem",
          }}
        >
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

          {/* Map with draggable marker — fixed block height so it
              scrolls with the rest of the form rather than commandeering
              the viewport on phones. */}
          <div
            style={{
              width: "100%",
              height: 240,
              border: `1px solid ${BORDER}`,
              marginBottom: "0.85rem",
              flexShrink: 0,
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
                    const nLat = e.latLng.lat();
                    const nLng = e.latLng.lng();
                    setLat(nLat);
                    setLng(nLng);
                    setPinTouched(true);
                    // Reverse-geocode only on dragEnd (not on every
                    // pixel) so we don't burn Geocoding API quota.
                    reverseGeocode(nLat, nLng);
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

          {/* Pin status — confirms to the operator that the marker is
              where they think it is. Reverse-geocoding spinner shows
              while we fetch address/area/pincode. */}
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "1rem",
              letterSpacing: "0.06em",
              color: pinTouched ? GOLD_SOFT : FADED,
              marginBottom: "0.85rem",
            }}
          >
            {pinTouched
              ? `Pin set at ${lat.toFixed(5)}, ${lng.toFixed(5)}`
              : "Drag the pin or search Google Maps above to set the location."}
            {geocoding ? " · resolving address…" : ""}
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
              <Select
                value={type}
                onChange={(v) => setType(v as PickupType)}
                ariaLabel="Location type"
                options={[
                  { value: "stall", label: "Stall" },
                  { value: "kitchen", label: "Store" },
                  { value: "partner_pickup", label: "Other Place" },
                ]}
              />
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
              <Label>Pincode</Label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={pincode}
                onChange={(e) =>
                  setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="auto-filled from map"
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
                fontSize: "1rem",
                marginTop: "0.75rem",
              }}
            >
              {err}
            </p>
          ) : null}
        </div>

        {/* Sticky footer */}
        <div
          className="flex gap-2 justify-end"
          style={{
            flexShrink: 0,
            padding: "0.9rem 1.25rem",
            borderTop: `1px solid ${BORDER}`,
            background: "rgb(6,4,2)",
          }}
        >
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
        fontSize: "0.875rem",
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
  fontSize: "0.875rem",
  letterSpacing: "0.25em",
  color: GOLD,
  border: `1px solid ${GOLD}`,
  padding: "0.45rem 0.9rem",
  background: "transparent",
  cursor: "pointer",
};
const miniBtn: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
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
  fontSize: "1rem",
};
