"use client";

// Admin: manage which pincodes Cadieux currently delivers to. A pincode
// can hold multiple area labels (one-to-many) so a single 530017 row can
// surface as "MVP Colony" + "Lawson's Bay Colony" depending on which
// gated community the customer is in.
//
// This page also supports bulk activate/deactivate via a checkbox per
// row + a sticky action bar at the bottom of the viewport. Tabs split
// the list into Active / History (deactivated) / All so the operator
// can dial in the right scope before bulk-acting.

import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";

type ServiceAreaRow = {
  pincode: string;
  area_name: string;
  is_active: boolean;
  added_at: string;
  added_by: string | null;
};

type GroupedRow = {
  pincode: string;
  area_names: string[];
  is_active: boolean;
  added_at: string;
};

type Tab = "active" | "history" | "all";

const GOLD = "#f59e0b";
const CREAM = "#fbf3d4";
const FADED = "rgba(192,200,206,0.6)";
const BORDER = "rgba(245,158,11,0.18)";
const DARK_GREEN = "#024628";

export default function ServiceAreasPage() {
  const [rows, setRows] = useState<ServiceAreaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<Tab>("active");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const [newPincode, setNewPincode] = useState("");
  const [newAreas, setNewAreas] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await adminFetch<{ rows: ServiceAreaRow[] }>(
        "/api/admin/service-areas",
      );
      setRows(res.rows ?? []);
    } catch (e) {
      setError(
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
          ? e.message
          : "Failed to load service areas.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped: GroupedRow[] = useMemo(() => {
    const map = new Map<string, GroupedRow>();
    for (const r of rows) {
      const g = map.get(r.pincode);
      if (g) {
        g.area_names.push(r.area_name);
        // a pincode is "active" if any of its rows are active.
        if (r.is_active) g.is_active = true;
        if (r.added_at > g.added_at) g.added_at = r.added_at;
      } else {
        map.set(r.pincode, {
          pincode: r.pincode,
          area_names: [r.area_name],
          is_active: r.is_active,
          added_at: r.added_at,
        });
      }
    }
    const out = Array.from(map.values());
    out.sort((a, b) => a.pincode.localeCompare(b.pincode));
    return out;
  }, [rows]);

  const counts = useMemo(() => {
    let active = 0;
    let history = 0;
    for (const g of grouped) {
      if (g.is_active) active++;
      else history++;
    }
    return { active, history, all: grouped.length };
  }, [grouped]);

  // Tab filter first, then text search. We keep both independent so the
  // operator can land on "History" tab and still search a specific pincode.
  const filtered = useMemo(() => {
    const tabFiltered =
      tab === "active"
        ? grouped.filter((g) => g.is_active)
        : tab === "history"
          ? grouped.filter((g) => !g.is_active)
          : grouped;
    const q = search.trim().toLowerCase();
    if (!q) return tabFiltered;
    return tabFiltered.filter(
      (g) =>
        g.pincode.includes(q) ||
        g.area_names.some((a) => a.toLowerCase().includes(q)),
    );
  }, [grouped, tab, search]);

  // Reset selection whenever the visible set changes — selecting on a
  // different tab and acting elsewhere would be confusing.
  useEffect(() => {
    setSelected(new Set());
  }, [tab]);

  const visiblePincodes = useMemo(
    () => filtered.map((g) => g.pincode),
    [filtered],
  );
  const allVisibleSelected =
    visiblePincodes.length > 0 &&
    visiblePincodes.every((p) => selected.has(p));
  const someVisibleSelected =
    !allVisibleSelected && visiblePincodes.some((p) => selected.has(p));

  const toggleOne = (pincode: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pincode)) next.delete(pincode);
      else next.add(pincode);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const p of visiblePincodes) next.delete(p);
      } else {
        for (const p of visiblePincodes) next.add(p);
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const showNotice = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3500);
  };

  const suggestPincode = async () => {
    const firstArea = newAreas.split(",").map((s) => s.trim()).find(Boolean);
    if (!firstArea) {
      setAddError("Type an area name first so we can look it up.");
      return;
    }
    setAddError(null);
    setSuggestBusy(true);
    try {
      const res = await adminFetch<{ pincode: string | null }>(
        `/api/admin/service-areas/suggest-pincode?area=${encodeURIComponent(firstArea)}`,
      );
      if (res.pincode && /^\d{6}$/.test(res.pincode)) {
        setNewPincode(res.pincode);
        showNotice(`Filled pincode ${res.pincode} from "${firstArea}"`);
      } else {
        setAddError(`Could not find a pincode for "${firstArea}".`);
      }
    } catch (e) {
      setAddError(
        e instanceof AdminFetchError ? e.message : "Lookup failed",
      );
    } finally {
      setSuggestBusy(false);
    }
  };

  const submitNew = async () => {
    setAddError(null);
    const pincode = newPincode.replace(/\D/g, "");
    if (pincode.length !== 6) {
      setAddError("Pincode must be 6 digits");
      return;
    }
    const area_names = newAreas
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (area_names.length === 0) {
      setAddError("Add at least one area name");
      return;
    }
    setAddBusy(true);
    try {
      const res = await adminFetch<{
        ok: boolean;
        geocoded?: number;
        geocoded_failed?: number;
      }>("/api/admin/service-areas", {
        method: "POST",
        body: JSON.stringify({ pincode, area_names }),
      });
      setNewPincode("");
      setNewAreas("");
      const geo = res.geocoded ?? 0;
      const failed = res.geocoded_failed ?? 0;
      showNotice(
        failed === 0
          ? `Activated pincode ${pincode} (${geo} geocoded)`
          : `Activated pincode ${pincode} — ${failed} area${failed === 1 ? "" : "s"} could not be geocoded (proximity won't apply)`,
      );
      await load();
    } catch (e) {
      setAddError(
        e instanceof AdminFetchError ? e.message : "Failed to activate area",
      );
    } finally {
      setAddBusy(false);
    }
  };

  const deactivate = async (pincode: string) => {
    if (
      !confirm(
        `Deactivate pincode ${pincode}? Customers will no longer be able to check out.`,
      )
    )
      return;
    setBusy((b) => ({ ...b, [pincode]: true }));
    try {
      await adminFetch(`/api/admin/service-areas/${pincode}/deactivate`, {
        method: "POST",
      });
      showNotice(`Deactivated ${pincode}`);
      await load();
    } catch (e) {
      showNotice(
        e instanceof AdminFetchError ? e.message : "Failed to deactivate",
      );
    } finally {
      setBusy((b) => ({ ...b, [pincode]: false }));
    }
  };

  const reactivate = async (pincode: string) => {
    setBusy((b) => ({ ...b, [pincode]: true }));
    try {
      await adminFetch(`/api/admin/service-areas/${pincode}/reactivate`, {
        method: "POST",
      });
      showNotice(`Reactivated ${pincode}`);
      await load();
    } catch (e) {
      showNotice(
        e instanceof AdminFetchError ? e.message : "Failed to reactivate",
      );
    } finally {
      setBusy((b) => ({ ...b, [pincode]: false }));
    }
  };

  const runBulk = async (action: "activate" | "deactivate") => {
    const pincodes = Array.from(selected);
    if (pincodes.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await adminFetch<{
        succeeded: string[];
        failed: string[];
      }>("/api/admin/service-areas/bulk", {
        method: "POST",
        body: JSON.stringify({ action, pincodes }),
      });
      const ok = res.succeeded?.length ?? 0;
      const fail = res.failed?.length ?? 0;
      showNotice(
        fail === 0
          ? `${action === "activate" ? "Reactivated" : "Deactivated"} ${ok} pincode${ok === 1 ? "" : "s"}`
          : `${action} succeeded for ${ok}, failed for ${fail}`,
      );
      setSelected(new Set());
      setConfirmDeactivate(false);
      await load();
    } catch (e) {
      showNotice(
        e instanceof AdminFetchError ? e.message : `Bulk ${action} failed`,
      );
    } finally {
      setBulkBusy(false);
    }
  };

  const startBulkDeactivate = () => {
    if (selected.size === 0) return;
    setConfirmDeactivate(true);
  };

  return (
    <AdminShell
      title="Areas We Serve"
      subtitle={`${counts.active} active · ${counts.history} paused`}
      actions={
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="uppercase"
          style={{
            ...primaryBtn,
            cursor: refreshing ? "wait" : "pointer",
            opacity: refreshing ? 0.6 : 1,
          }}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      {notice && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            background: "rgba(34,197,94,0.12)",
            border: "1px solid rgba(34,197,94,0.45)",
            color: "#bbf7d0",
            fontFamily: "var(--font-body)",
            fontSize: 12,
            letterSpacing: "0.05em",
          }}
        >
          {notice}
        </div>
      )}

      {/* Add new pincode */}
      <div
        style={{
          marginBottom: 28,
          padding: 18,
          background: "rgba(10,8,5,0.5)",
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
        }}
      >
        <div
          className="uppercase"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.65rem",
            letterSpacing: "0.3em",
            color: GOLD,
            marginBottom: 12,
          }}
        >
          Activate new pincode
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "flex-start",
          }}
        >
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="Pincode (e.g. 530017)"
            value={newPincode}
            onChange={(e) =>
              setNewPincode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            style={inputBase}
          />
          <input
            type="text"
            placeholder="Area names — comma separated"
            value={newAreas}
            onChange={(e) => setNewAreas(e.target.value)}
            style={{ ...inputBase, flex: 1, minWidth: 240 }}
          />
          <button
            type="button"
            onClick={suggestPincode}
            disabled={suggestBusy || addBusy}
            title="Look up pincode for the first area name via Google Maps"
            className="uppercase"
            style={{
              ...primaryBtn,
              opacity: suggestBusy ? 0.6 : 1,
              cursor: suggestBusy ? "wait" : "pointer",
            }}
          >
            {suggestBusy ? "Looking…" : "↧ Pincode"}
          </button>
          <button
            type="button"
            onClick={submitNew}
            disabled={addBusy}
            className="uppercase"
            style={primaryBtn}
          >
            {addBusy ? "Saving…" : "Activate Area"}
          </button>
        </div>
        {addError && (
          <p
            style={{
              margin: "10px 0 0",
              color: "#ef4444",
              fontFamily: "var(--font-body)",
              fontSize: 12,
            }}
          >
            {addError}
          </p>
        )}
      </div>

      {/* Tab chips */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 12,
        }}
      >
        {(["active", "history", "all"] as Tab[]).map((t) => {
          const active = tab === t;
          const label = t === "active" ? "Active" : t === "history" ? "History" : "All";
          const c = counts[t];
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className="uppercase"
              style={{
                background: active ? "rgba(245,158,11,0.15)" : "transparent",
                border: `1px solid ${active ? "rgba(245,158,11,0.7)" : "rgba(245,158,11,0.25)"}`,
                color: active ? CREAM : "rgba(251,243,212,0.55)",
                padding: "6px 14px",
                fontFamily: "var(--font-body)",
                fontSize: "0.65rem",
                letterSpacing: "0.22em",
                cursor: "pointer",
              }}
            >
              {label}
              <span style={{ marginLeft: 8, opacity: 0.7 }}>{c}</span>
            </button>
          );
        })}
      </div>

      <input
        type="text"
        placeholder="Search by pincode or area…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ ...inputBase, width: "100%", marginBottom: 16 }}
      />

      {loading ? (
        <p style={mutedText}>Loading…</p>
      ) : error ? (
        <p style={{ ...mutedText, color: "#ef4444" }}>{error}</p>
      ) : filtered.length === 0 ? (
        <p style={mutedText}>No pincodes match.</p>
      ) : (
        <div
          style={{
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            overflow: "hidden",
            // Leave breathing room for the sticky bulk bar.
            marginBottom: selected.size > 0 ? 80 : 0,
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: 640,
              }}
            >
              <thead>
                <tr style={{ background: "rgba(10,8,5,0.6)" }}>
                  <th style={{ ...th, width: 40, paddingRight: 6 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all visible"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someVisibleSelected;
                      }}
                      onChange={toggleAllVisible}
                    />
                  </th>
                  <th style={th}>Pincode</th>
                  <th style={th}>Areas</th>
                  <th style={th}>Added</th>
                  <th style={th}>Status</th>
                  <th style={{ ...th, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((g) => {
                  const checked = selected.has(g.pincode);
                  return (
                    <tr
                      key={g.pincode}
                      style={{
                        borderTop: `1px solid ${BORDER}`,
                        background: checked
                          ? "rgba(245,158,11,0.06)"
                          : "transparent",
                      }}
                    >
                      <td style={{ ...td, paddingRight: 6 }}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${g.pincode}`}
                          checked={checked}
                          onChange={() => toggleOne(g.pincode)}
                        />
                      </td>
                      <td style={{ ...td, fontWeight: 500, color: CREAM }}>
                        {g.pincode}
                      </td>
                      <td style={td}>{g.area_names.join(", ")}</td>
                      <td style={{ ...td, color: FADED, whiteSpace: "nowrap" }}>
                        {new Date(g.added_at).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td style={td}>
                        <span
                          className="uppercase"
                          style={{
                            fontFamily: "var(--font-body)",
                            fontSize: "0.55rem",
                            letterSpacing: "0.25em",
                            padding: "2px 8px",
                            borderRadius: 99,
                            border: g.is_active
                              ? "1px solid rgba(34,197,94,0.5)"
                              : "1px solid rgba(192,200,206,0.3)",
                            color: g.is_active ? "#bbf7d0" : FADED,
                            background: g.is_active
                              ? "rgba(34,197,94,0.12)"
                              : "transparent",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {g.is_active ? "Active" : "Paused"}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {g.is_active ? (
                          <button
                            onClick={() => deactivate(g.pincode)}
                            disabled={busy[g.pincode]}
                            className="uppercase"
                            style={dangerBtn}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            onClick={() => reactivate(g.pincode)}
                            disabled={busy[g.pincode]}
                            className="uppercase"
                            style={primaryBtn}
                          >
                            Reactivate
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sticky bulk action bar */}
      {selected.size > 0 && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 200,
            background: "rgba(6,4,2,0.96)",
            borderTop: `1px solid ${DARK_GREEN}`,
            padding:
              "0.9rem clamp(1rem, 4vw, 1.5rem) calc(0.9rem + env(safe-area-inset-bottom))",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
              justifyContent: "space-between",
            }}
          >
            <div
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.7rem",
                letterSpacing: "0.22em",
                color: CREAM,
              }}
            >
              {selected.size} selected
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={clearSelection}
                disabled={bulkBusy}
                className="uppercase"
                style={{
                  ...primaryBtn,
                  color: FADED,
                  borderColor: "rgba(192,200,206,0.4)",
                }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => void runBulk("activate")}
                disabled={bulkBusy}
                className="uppercase"
                style={{
                  ...primaryBtn,
                  cursor: bulkBusy ? "wait" : "pointer",
                  opacity: bulkBusy ? 0.6 : 1,
                }}
              >
                {bulkBusy ? "Working…" : "Activate"}
              </button>
              <button
                type="button"
                onClick={startBulkDeactivate}
                disabled={bulkBusy}
                className="uppercase"
                style={{
                  ...dangerBtn,
                  padding: "8px 16px",
                  fontSize: "0.65rem",
                  cursor: bulkBusy ? "wait" : "pointer",
                  opacity: bulkBusy ? 0.6 : 1,
                }}
              >
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk deactivate confirmation */}
      {confirmDeactivate && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => !bulkBusy && setConfirmDeactivate(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 400,
            background: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "rgb(6,4,2)",
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              maxWidth: 420,
              width: "100%",
              fontFamily: "var(--font-body)",
              color: CREAM,
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
                padding: "1.25rem 1.5rem 1rem",
                background: "rgb(6,4,2)",
                borderBottom: `1px solid ${BORDER}`,
              }}
            >
              <h3
                className="uppercase"
                style={{
                  margin: 0,
                  fontFamily: "var(--font-heading)",
                  fontWeight: 300,
                  fontSize: "1.1rem",
                  letterSpacing: "0.18em",
                  color: CREAM,
                }}
              >
                Confirm bulk deactivate
              </h3>
            </div>
            <div
              style={{
                flex: "1 1 auto",
                minHeight: 0,
                overflowY: "auto",
                WebkitOverflowScrolling: "touch",
                padding: "1rem 1.5rem",
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: "0.85rem",
                  color: "rgba(251,243,212,0.75)",
                  lineHeight: 1.5,
                }}
              >
                You&rsquo;re about to deactivate{" "}
                <strong>{selected.size} pincode{selected.size === 1 ? "" : "s"}</strong>.
                Customers in these pincodes won&rsquo;t be able to check out until
                they&rsquo;re reactivated.
              </p>
            </div>
            <div
              style={{
                flexShrink: 0,
                padding: "1rem 1.5rem 1.25rem",
                background: "rgb(6,4,2)",
                borderTop: `1px solid ${BORDER}`,
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={() => setConfirmDeactivate(false)}
                disabled={bulkBusy}
                className="uppercase"
                style={{
                  ...primaryBtn,
                  color: FADED,
                  borderColor: "rgba(192,200,206,0.4)",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void runBulk("deactivate")}
                disabled={bulkBusy}
                className="uppercase"
                style={{
                  ...dangerBtn,
                  padding: "8px 16px",
                  fontSize: "0.65rem",
                  cursor: bulkBusy ? "wait" : "pointer",
                  opacity: bulkBusy ? 0.6 : 1,
                }}
              >
                {bulkBusy ? "Working…" : "Deactivate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

const inputBase: React.CSSProperties = {
  background: "rgba(6,4,2,0.6)",
  border: `1px solid ${BORDER}`,
  borderRadius: 4,
  padding: "8px 12px",
  color: CREAM,
  fontFamily: "var(--font-body)",
  fontSize: 13,
  letterSpacing: "0.04em",
  outline: "none",
};

const primaryBtn: React.CSSProperties = {
  border: `1px solid ${GOLD}`,
  color: GOLD,
  fontFamily: "var(--font-body)",
  fontSize: "0.65rem",
  letterSpacing: "0.25em",
  padding: "8px 16px",
  background: "transparent",
  cursor: "pointer",
};

const dangerBtn: React.CSSProperties = {
  border: "1px solid rgba(239,68,68,0.5)",
  color: "#ef4444",
  fontFamily: "var(--font-body)",
  fontSize: "0.6rem",
  letterSpacing: "0.25em",
  padding: "6px 12px",
  background: "transparent",
  cursor: "pointer",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  fontFamily: "var(--font-body)",
  fontSize: "0.65rem",
  letterSpacing: "0.25em",
  color: FADED,
  textTransform: "uppercase",
  fontWeight: 400,
};

const td: React.CSSProperties = {
  padding: "10px 14px",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  color: "rgba(251,243,212,0.85)",
  verticalAlign: "middle",
};

const mutedText: React.CSSProperties = {
  color: FADED,
  fontFamily: "var(--font-body)",
  fontSize: 13,
};
