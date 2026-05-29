"use client";

// /admin/audit — UNIFIED audit trail.
//
// Reads logistics.audit_logs (the cross-panel log fed by the dashboard,
// the public-schema triggers, and the product-lock flow) via
// /api/admin/audit. Distinct from /admin/audit-log, which reads the
// website-only public.audit_log table.
//
// Read-only + immutable: no edit/delete affordances anywhere; CSV export
// only. Filters (date / source / action / category / search) are applied
// server-side; the returned rows (≤2000) are paginated 50/page client-side.

import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { csvFilename, downloadCsv, toCsv } from "@/lib/admin-csv";
import { formatDateTime } from "@/lib/admin-formatting";

const GOLD = "#f59e0b";
const GOLD_SOFT = "rgba(245,158,11,0.85)";
const CREAM = "#fbf3d4";
const GREEN = "#024628";
const FADED = "rgba(192,200,206,0.6)";
const BORDER = "rgba(245,158,11,0.18)";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const PER_PAGE = 50;

type AuditRow = {
  id: string;
  created_at: string;
  source: string | null;
  user_id: string | null;
  user_name: string | null;
  action_type: string | null;
  entity_type: string | null;
  entity_id: string | null;
  category: string | null;
  description: string | null;
  old_values: unknown;
  new_values: unknown;
  metadata: unknown;
};

const DATE_PRESETS = [
  { key: "today", label: "Today", days: 1 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "all", label: "All", days: 0 },
  { key: "custom", label: "Custom", days: -1 },
] as const;
type PresetKey = (typeof DATE_PRESETS)[number]["key"];

const ACTIONS = ["all", "CREATE", "UPDATE", "DELETE", "LOGIN"];
const SOURCES = ["all", "website", "dashboard"];
const CATEGORIES = [
  "all",
  "order",
  "product",
  "customer",
  "review",
  "location",
  "store",
  "partner",
  "sale",
  "lead",
];

function actionColor(a: string | null): string {
  switch (a) {
    case "CREATE":
      return "#4ade80";
    case "UPDATE":
      return GOLD;
    case "DELETE":
      return "#ef4444";
    case "LOGIN":
      return "#22d3ee";
    case "BLOCKED":
      return "#fb923c";
    case "LOCKOUT":
      return "#f43f5e";
    default:
      return FADED;
  }
}

function safeJson(value: unknown, indent = 2): string {
  if (value === null || value === undefined) return "—";
  try {
    return JSON.stringify(value, null, indent);
  } catch {
    return "(unserializable)";
  }
}

export default function UnifiedAuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preset, setPreset] = useState<PresetKey>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [action, setAction] = useState("all");
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const buildParams = useCallback(() => {
    const sp = new URLSearchParams();
    if (preset === "custom") {
      if (customFrom) sp.set("from", `${customFrom}T00:00:00.000Z`);
      if (customTo) {
        const d = new Date(`${customTo}T00:00:00.000Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        sp.set("to", d.toISOString());
      }
    } else {
      const days = DATE_PRESETS.find((p) => p.key === preset)?.days ?? 0;
      if (days > 0) sp.set("days", String(days));
    }
    if (action !== "all") sp.set("action", action);
    if (source !== "all") sp.set("source", source);
    if (category !== "all") sp.set("category", category);
    if (search.trim()) sp.set("search", search.trim());
    return sp;
  }, [preset, customFrom, customTo, action, source, category, search]);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const qs = buildParams().toString();
      const res = await adminFetch<{ rows: AuditRow[] }>(
        qs ? `/api/admin/audit?${qs}` : "/api/admin/audit",
      );
      setRows(res.rows ?? []);
    } catch (e) {
      setError(
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
          ? e.message
          : "Failed to load audit trail",
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [preset, customFrom, customTo, action, source, category, search]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const pageRows = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  function exportCsv() {
    const csv = toCsv(rows, [
      { header: "Timestamp", value: (r) => r.created_at },
      { header: "Source", value: (r) => r.source ?? "" },
      { header: "User", value: (r) => r.user_name ?? "" },
      { header: "Action", value: (r) => r.action_type ?? "" },
      { header: "Category", value: (r) => r.category ?? "" },
      { header: "Entity", value: (r) => r.entity_type ?? "" },
      { header: "Description", value: (r) => r.description ?? "" },
      { header: "Before", value: (r) => safeJson(r.old_values, 0) },
      { header: "After", value: (r) => safeJson(r.new_values, 0) },
    ]);
    downloadCsv(csvFilename("audit-trail"), csv);
  }

  return (
    <AdminShell
      title="Audit Trail"
      subtitle={`${rows.length} event${rows.length === 1 ? "" : "s"} · all panels`}
      actions={
        <>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="uppercase"
            style={{ ...chipBtn, cursor: refreshing ? "wait" : "pointer", opacity: refreshing ? 0.6 : 1 }}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" onClick={exportCsv} className="uppercase" style={chipBtn}>
            Export CSV
          </button>
        </>
      }
    >
      {/* Immutability banner */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          border: `1px solid ${GREEN}`,
          background: "rgba(2,70,40,0.18)",
          padding: "0.7rem 1rem",
          marginBottom: "1.25rem",
        }}
      >
        <span aria-hidden style={{ fontSize: "1rem" }}>
          🔒
        </span>
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.8rem",
            letterSpacing: "0.04em",
            color: CREAM,
          }}
        >
          Audit logs are permanent and cannot be edited or deleted.
        </span>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3" style={{ marginBottom: "1.25rem" }}>
        <div className="flex items-center gap-2 flex-wrap">
          <FilterLabel>Date</FilterLabel>
          {DATE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset(p.key)}
              className="uppercase"
              style={presetChip(preset === p.key)}
            >
              {p.label}
            </button>
          ))}
          {preset === "custom" ? (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="From date"
                style={dateInput}
              />
              <span style={{ color: FADED }}>—</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label="To date"
                style={dateInput}
              />
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <FilterLabel>Source</FilterLabel>
          <Select value={source} onChange={setSource} options={SOURCES} />
          <FilterLabel>Action</FilterLabel>
          <Select value={action} onChange={setAction} options={ACTIONS} />
          <FilterLabel>Category</FilterLabel>
          <Select value={category} onChange={setCategory} options={CATEGORIES} />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search user, description, category…"
            style={{
              border: `1px solid ${BORDER}`,
              background: "transparent",
              color: CREAM,
              fontFamily: "var(--font-body)",
              fontSize: "0.85rem",
              padding: "0.5rem 0.75rem",
              minWidth: 280,
              flex: "1 1 280px",
            }}
          />
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            border: "1px solid rgba(239,68,68,0.55)",
            background: "rgba(239,68,68,0.08)",
            padding: "0.85rem 1rem",
            color: "#fecaca",
            fontFamily: "var(--font-body)",
            fontSize: "0.85rem",
            marginBottom: "1rem",
          }}
        >
          {error}
        </div>
      ) : null}

      <div style={{ border: `1px solid ${BORDER}`, background: "rgba(0,0,0,0.18)" }}>
        <div className="overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
          <table
            style={{
              width: "100%",
              minWidth: 920,
              borderCollapse: "collapse",
              fontFamily: MONO,
              color: CREAM,
              fontSize: "0.8rem",
            }}
          >
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  color: GOLD_SOFT,
                  fontSize: "0.6rem",
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  fontFamily: "var(--font-body)",
                }}
              >
                <th style={th}>Timestamp</th>
                <th style={th}>Source</th>
                <th style={th}>User</th>
                <th style={th}>Action</th>
                <th style={th}>Category</th>
                <th style={th}>Description</th>
                <th style={th}>Before / After</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ ...td, color: FADED }}>
                    Loading…
                  </td>
                </tr>
              ) : pageRows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...td, color: FADED }}>
                    No events match the current filters.
                  </td>
                </tr>
              ) : (
                pageRows.map((r, idx) => {
                  const hasDiff =
                    r.old_values != null || r.new_values != null;
                  const open = expanded === r.id;
                  const zebra =
                    idx % 2 === 0 ? "transparent" : "rgba(245,158,11,0.04)";
                  return (
                    <FragmentRow
                      key={r.id}
                      r={r}
                      hasDiff={hasDiff}
                      open={open}
                      zebra={zebra}
                      onToggle={() => setExpanded(open ? null : r.id)}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3" style={{ marginTop: "1rem" }}>
        <span style={{ color: FADED, fontSize: "0.75rem", fontFamily: "var(--font-body)" }}>
          {rows.length === 0
            ? "No events"
            : `Showing ${(page - 1) * PER_PAGE + 1}–${Math.min(page * PER_PAGE, rows.length)} of ${rows.length}`}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page === 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="uppercase"
            style={{ ...pagerBtn, opacity: page === 1 || loading ? 0.45 : 1 }}
          >
            ← Newer
          </button>
          <span style={{ color: FADED, fontSize: "0.72rem", alignSelf: "center", fontFamily: "var(--font-body)" }}>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="uppercase"
            style={{ ...pagerBtn, opacity: page >= totalPages || loading ? 0.45 : 1 }}
          >
            Older →
          </button>
        </div>
      </div>
    </AdminShell>
  );
}

function FragmentRow({
  r,
  hasDiff,
  open,
  zebra,
  onToggle,
}: {
  r: AuditRow;
  hasDiff: boolean;
  open: boolean;
  zebra: string;
  onToggle: () => void;
}) {
  return (
    <>
      <tr style={{ borderTop: `1px solid ${BORDER}`, background: zebra }}>
        <td style={td}>{formatDateTime(r.created_at)}</td>
        <td style={td}>
          <SourceBadge source={r.source} />
        </td>
        <td style={td}>
          <span style={{ color: CREAM, fontFamily: "var(--font-body)" }}>
            {r.user_name || "—"}
          </span>
        </td>
        <td style={td}>
          <span style={{ color: actionColor(r.action_type), fontWeight: 600 }}>
            {r.action_type || "—"}
          </span>
        </td>
        <td style={{ ...td, textTransform: "capitalize" }}>{r.category || "—"}</td>
        <td style={{ ...td, fontFamily: "var(--font-body)" }}>
          {r.description || "—"}
          {r.entity_id ? (
            <div style={{ color: FADED, fontSize: "0.68rem", wordBreak: "break-all", marginTop: 2 }}>
              {r.entity_type ? `${r.entity_type} · ` : ""}
              {r.entity_id}
            </div>
          ) : null}
        </td>
        <td style={td}>
          {hasDiff ? (
            <button
              type="button"
              onClick={onToggle}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.6rem",
                letterSpacing: "0.18em",
                color: GOLD_SOFT,
                border: `1px solid ${BORDER}`,
                padding: "0.25rem 0.6rem",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              {open ? "Hide" : "View"}
            </button>
          ) : (
            <span style={{ color: FADED }}>—</span>
          )}
        </td>
      </tr>
      {open && hasDiff ? (
        <tr style={{ background: "rgba(0,0,0,0.3)" }}>
          <td colSpan={7} style={{ padding: "0.85rem" }}>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
              <DiffBlock label="Before" value={r.old_values} tone="#ef4444" />
              <DiffBlock label="After" value={r.new_values} tone="#4ade80" />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function DiffBlock({ label, value, tone }: { label: string; value: unknown; tone: string }) {
  return (
    <div style={{ border: `1px solid ${tone}55`, background: "rgba(0,0,0,0.25)", padding: "0.6rem 0.7rem" }}>
      <div
        className="uppercase"
        style={{ color: tone, fontFamily: "var(--font-body)", fontSize: "0.6rem", letterSpacing: "0.2em", marginBottom: "0.4rem" }}
      >
        {label}
      </div>
      <pre
        style={{
          margin: 0,
          color: CREAM,
          fontFamily: MONO,
          fontSize: "0.72rem",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 260,
          overflow: "auto",
        }}
      >
        {safeJson(value)}
      </pre>
    </div>
  );
}

function SourceBadge({ source }: { source: string | null }) {
  const isWebsite = source === "website";
  const color = isWebsite ? "#4ade80" : GOLD;
  const label = source || "—";
  return (
    <span
      className="uppercase"
      style={{
        fontFamily: "var(--font-body)",
        fontSize: "0.58rem",
        letterSpacing: "0.16em",
        color,
        border: `1px solid ${color}`,
        padding: "0.12rem 0.45rem",
      }}
    >
      {label}
    </span>
  );
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="uppercase"
      style={{
        color: FADED,
        fontSize: "0.6rem",
        letterSpacing: "0.22em",
        fontFamily: "var(--font-body)",
        minWidth: 56,
      }}
    >
      {children}
    </span>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="capitalize"
      style={{
        background: "transparent",
        color: CREAM,
        border: `1px solid ${BORDER}`,
        padding: "0.45rem 0.65rem",
        fontFamily: "var(--font-body)",
        fontSize: "0.8rem",
      }}
    >
      {options.map((o) => (
        <option key={o} value={o} style={{ background: "#0a0a0a", color: CREAM }}>
          {o === "all" ? "All" : o}
        </option>
      ))}
    </select>
  );
}

const th: React.CSSProperties = {
  padding: "0.6rem 0.8rem",
  fontWeight: 400,
  borderBottom: `1px solid ${BORDER}`,
};
const td: React.CSSProperties = {
  padding: "0.65rem 0.8rem",
  verticalAlign: "top",
};
const chipBtn: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.7rem",
  letterSpacing: "0.25em",
  color: GOLD,
  border: `1px solid ${GOLD}`,
  padding: "0.45rem 0.9rem",
  background: "transparent",
};
const pagerBtn: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.65rem",
  letterSpacing: "0.22em",
  padding: "0.35rem 0.85rem",
  color: GOLD_SOFT,
  background: "transparent",
  border: `1px solid ${BORDER}`,
  cursor: "pointer",
};
const dateInput: React.CSSProperties = {
  background: "transparent",
  border: `1px solid ${BORDER}`,
  color: CREAM,
  fontFamily: "var(--font-body)",
  fontSize: "0.78rem",
  padding: "0.3rem 0.5rem",
};
function presetChip(active: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-body)",
    fontSize: "0.62rem",
    letterSpacing: "0.2em",
    padding: "0.35rem 0.7rem",
    color: active ? "#06120c" : GOLD_SOFT,
    background: active ? GOLD : "transparent",
    border: `1px solid ${active ? GOLD : "rgba(245,158,11,0.4)"}`,
    cursor: "pointer",
  };
}
