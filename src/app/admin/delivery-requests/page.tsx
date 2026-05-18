"use client";

// Admin: customer-submitted "deliver here please" requests from
// unserviceable pincodes. Two actions per row:
//   - Mark Serviceable: activates the pincode + WhatsApps the customer.
//   - Reject: silently dismisses (admin can follow up manually).

import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { ContactActions } from "@/components/admin/ContactActions";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";

type RequestRow = {
  id: string;
  customer_id: string | null;
  phone: string;
  pincode: string;
  area_name: string | null;
  address: string;
  status: "pending" | "serviceable" | "rejected";
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: string;
  customer: { id: string; full_name: string | null } | null;
};

const GOLD = "#f59e0b";
const CREAM = "#fbf3d4";
const FADED = "rgba(192,200,206,0.6)";
const BORDER = "rgba(245,158,11,0.18)";

const FILTERS: { value: "pending" | "serviceable" | "rejected" | "all"; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "serviceable", label: "Activated" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

export default function DeliveryRequestsPage() {
  const [filter, setFilter] =
    useState<"pending" | "serviceable" | "rejected" | "all">("pending");
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [areaInputs, setAreaInputs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await adminFetch<{ requests: RequestRow[] }>(
        `/api/admin/delivery-requests?status=${filter}`,
      );
      setRows(res.requests ?? []);
    } catch (e) {
      setError(
        e instanceof AdminFetchError ? e.message : "Failed to load requests.",
      );
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const counts = useMemo(() => {
    return {
      total: rows.length,
    };
  }, [rows]);

  const showNotice = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3500);
  };

  const markServiceable = async (row: RequestRow) => {
    const area = (areaInputs[row.id] ?? row.area_name ?? "").trim();
    if (!area) {
      showNotice("Enter an area name before activating.");
      return;
    }
    setBusy((b) => ({ ...b, [row.id]: true }));
    try {
      await adminFetch(
        `/api/admin/delivery-requests/${row.id}/mark-serviceable`,
        {
          method: "POST",
          body: JSON.stringify({ area_name: area }),
        },
      );
      showNotice(`Activated ${row.pincode} (${area}). WhatsApp sent.`);
      await load();
    } catch (e) {
      showNotice(
        e instanceof AdminFetchError ? e.message : "Failed to activate",
      );
    } finally {
      setBusy((b) => ({ ...b, [row.id]: false }));
    }
  };

  const reject = async (row: RequestRow) => {
    if (!confirm(`Reject request for ${row.pincode}? The customer is not notified automatically.`)) return;
    setBusy((b) => ({ ...b, [row.id]: true }));
    try {
      await adminFetch(`/api/admin/delivery-requests/${row.id}/reject`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      showNotice("Request rejected.");
      await load();
    } catch (e) {
      showNotice(
        e instanceof AdminFetchError ? e.message : "Failed to reject",
      );
    } finally {
      setBusy((b) => ({ ...b, [row.id]: false }));
    }
  };

  return (
    <AdminShell
      title="Delivery Requests"
      subtitle={`${counts.total} ${filter}`}
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

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        {FILTERS.map((f) => {
          const active = f.value === filter;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.65rem",
                letterSpacing: "0.25em",
                padding: "6px 14px",
                background: active ? "rgba(245,158,11,0.15)" : "transparent",
                border: `1px solid ${active ? GOLD : BORDER}`,
                color: active ? GOLD : FADED,
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <p style={mutedText}>Loading…</p>
      ) : error ? (
        <p style={{ ...mutedText, color: "#ef4444" }}>{error}</p>
      ) : rows.length === 0 ? (
        <p style={mutedText}>No requests in this status.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((r) => (
            <div
              key={r.id}
              style={{
                padding: 18,
                background: "rgba(10,8,5,0.5)",
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 14,
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-heading)",
                      color: CREAM,
                      fontSize: "1.4rem",
                      letterSpacing: "0.1em",
                    }}
                  >
                    {r.pincode}
                  </span>
                  <span
                    className="uppercase"
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: "0.6rem",
                      letterSpacing: "0.25em",
                      padding: "3px 10px",
                      borderRadius: 99,
                      border: statusBorder(r.status),
                      color: statusColor(r.status),
                      background: statusBg(r.status),
                    }}
                  >
                    {r.status}
                  </span>
                  <span style={{ ...mutedText, fontSize: 12 }}>
                    {new Date(r.created_at).toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <ContactActions
                  phone={r.phone}
                  customerName={r.customer?.full_name ?? null}
                  stopPropagation={false}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "minmax(140px,180px) 1fr", gap: 10 }}>
                <span style={labelStyle}>Customer</span>
                <span style={valueStyle}>
                  {r.customer?.full_name ? (
                    <a
                      href={`/admin/customers/${r.customer.id}`}
                      style={{ color: GOLD, textDecoration: "none" }}
                    >
                      {r.customer.full_name}
                    </a>
                  ) : (
                    <span style={{ color: FADED }}>Not registered</span>
                  )}{" "}
                  <span style={{ color: FADED }}>· +91 {r.phone}</span>
                </span>

                <span style={labelStyle}>Address</span>
                <span style={valueStyle}>{r.address}</span>

                {r.area_name && (
                  <>
                    <span style={labelStyle}>Suggested area</span>
                    <span style={valueStyle}>{r.area_name}</span>
                  </>
                )}

                {r.resolution_note && (
                  <>
                    <span style={labelStyle}>Note</span>
                    <span style={valueStyle}>{r.resolution_note}</span>
                  </>
                )}
              </div>

              {r.status === "pending" && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    alignItems: "center",
                    borderTop: `1px solid ${BORDER}`,
                    paddingTop: 12,
                  }}
                >
                  <input
                    type="text"
                    placeholder="Area name to activate (e.g. MVP Colony)"
                    value={areaInputs[r.id] ?? r.area_name ?? ""}
                    onChange={(e) =>
                      setAreaInputs((s) => ({ ...s, [r.id]: e.target.value }))
                    }
                    style={{ ...inputBase, flex: 1, minWidth: 220 }}
                  />
                  <button
                    type="button"
                    onClick={() => markServiceable(r)}
                    disabled={busy[r.id]}
                    className="uppercase"
                    style={primaryBtn}
                  >
                    {busy[r.id] ? "Saving…" : "Mark Serviceable"}
                  </button>
                  <button
                    type="button"
                    onClick={() => reject(r)}
                    disabled={busy[r.id]}
                    className="uppercase"
                    style={dangerBtn}
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </AdminShell>
  );
}

function statusColor(s: RequestRow["status"]): string {
  if (s === "serviceable") return "#bbf7d0";
  if (s === "rejected") return "rgba(192,200,206,0.6)";
  return "#fcd34d";
}

function statusBorder(s: RequestRow["status"]): string {
  if (s === "serviceable") return "1px solid rgba(34,197,94,0.5)";
  if (s === "rejected") return "1px solid rgba(192,200,206,0.3)";
  return "1px solid rgba(245,158,11,0.5)";
}

function statusBg(s: RequestRow["status"]): string {
  if (s === "serviceable") return "rgba(34,197,94,0.12)";
  if (s === "rejected") return "transparent";
  return "rgba(245,158,11,0.12)";
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

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.6rem",
  letterSpacing: "0.25em",
  color: FADED,
  textTransform: "uppercase",
  alignSelf: "start",
  paddingTop: 2,
};

const valueStyle: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 13,
  color: "rgba(251,243,212,0.85)",
};

const mutedText: React.CSSProperties = {
  color: FADED,
  fontFamily: "var(--font-body)",
  fontSize: 13,
};
