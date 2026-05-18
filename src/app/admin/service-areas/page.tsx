"use client";

// Admin: manage which pincodes Cadieux currently delivers to. A pincode
// can hold multiple area labels (one-to-many) so a single 530017 row can
// surface as "MVP Colony" + "Lawson's Bay Colony" depending on which
// gated community the customer is in.

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

const GOLD = "#f59e0b";
const CREAM = "#fbf3d4";
const FADED = "rgba(192,200,206,0.6)";
const BORDER = "rgba(245,158,11,0.18)";

export default function ServiceAreasPage() {
  const [rows, setRows] = useState<ServiceAreaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const [newPincode, setNewPincode] = useState("");
  const [newAreas, setNewAreas] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return grouped;
    return grouped.filter(
      (g) =>
        g.pincode.includes(q) ||
        g.area_names.some((a) => a.toLowerCase().includes(q)),
    );
  }, [grouped, search]);

  const showNotice = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3500);
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
      await adminFetch("/api/admin/service-areas", {
        method: "POST",
        body: JSON.stringify({ pincode, area_names }),
      });
      setNewPincode("");
      setNewAreas("");
      showNotice(`Activated pincode ${pincode}`);
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
    if (!confirm(`Deactivate pincode ${pincode}? Customers will no longer be able to check out.`)) return;
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

  return (
    <AdminShell
      title="Service Areas"
      subtitle={`${grouped.length} pincodes`}
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
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "rgba(10,8,5,0.6)" }}>
                <th style={th}>Pincode</th>
                <th style={th}>Areas</th>
                <th style={th}>Added</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <tr key={g.pincode} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={{ ...td, fontWeight: 500, color: CREAM }}>
                    {g.pincode}
                  </td>
                  <td style={td}>{g.area_names.join(", ")}</td>
                  <td style={{ ...td, color: FADED }}>
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
              ))}
            </tbody>
          </table>
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
