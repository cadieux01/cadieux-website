"use client";

// /admin/audit — UNIFIED audit trail.
//
// Reads logistics.audit_logs (the cross-panel log fed by the dashboard,
// the public-schema triggers, and the website super-admin) via
// /api/admin/audit. Distinct from /admin/audit-log, which reads the
// website-only public.audit_log table.
//
// Read-only + immutable: no edit/delete affordances anywhere; CSV export
// only. Filters (date / source / action / category / search) are applied
// server-side; the returned rows (≤2000) are paginated 50/page client-side.

import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import BrandSelect from "@/components/ui/Select";
import {
  DateRangeDropdown,
  resolvePreset,
  type DateRangeValue,
} from "@/components/admin/DateRangeDropdown";
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

// ── Human-readable diff helpers ────────────────────────────────────────────
// Keys whose numeric values should be rendered as INR currency.
const PRICE_KEYS = new Set([
  "price",
  "amount",
  "total",
  "total_amount",
  "subtotal",
  "tax",
  "discount",
  "discount_amount",
  "paid",
  "paid_amount",
  "refund",
  "refund_amount",
  "fee",
  "delivery_fee",
  "delivery_charge",
  "shipping",
  "shipping_amount",
  "mrp",
  "cost",
  "balance",
  "wallet_credit",
  "wallet_debit",
  "gst",
  "cgst",
  "sgst",
  "igst",
]);

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

function isIsoDateLike(s: string): boolean {
  // ISO 8601 with date and (usually) time, or plain YYYY-MM-DD.
  if (!/^\d{4}-\d{2}-\d{2}(T|\s|$)/.test(s)) return false;
  const t = Date.parse(s);
  return Number.isFinite(t);
}

function formatHumanDate(s: string): string {
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    const hasTime = /T|\s\d{2}:/.test(s);
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...(hasTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
  } catch {
    return s;
  }
}

function formatHumanValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "(none)";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (PRICE_KEYS.has(key.toLowerCase())) {
      return `₹${value.toLocaleString("en-IN")}`;
    }
    return value.toLocaleString("en-IN");
  }
  if (typeof value === "string") {
    if (PRICE_KEYS.has(key.toLowerCase()) && /^-?\d+(\.\d+)?$/.test(value)) {
      return `₹${Number(value).toLocaleString("en-IN")}`;
    }
    if (isIsoDateLike(value)) return formatHumanDate(value);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "(empty list)";
    return value
      .map((v) => formatHumanValue(key, v))
      .join(", ");
  }
  if (typeof value === "object") {
    try {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) return "(empty)";
      return entries
        .map(([k, v]) => `${humanizeKey(k)}: ${formatHumanValue(k, v)}`)
        .join("; ");
    } catch {
      return "(complex value)";
    }
  }
  return String(value);
}

type HumanEntry = { key: string; label: string; value: string };
type HumanChange = { key: string; label: string; oldText: string; newText: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function entriesOf(obj: Record<string, unknown> | null): HumanEntry[] {
  if (!obj) return [];
  return Object.entries(obj).map(([key, val]) => ({
    key,
    label: humanizeKey(key),
    value: formatHumanValue(key, val),
  }));
}

function changesBetween(
  oldObj: Record<string, unknown> | null,
  newObj: Record<string, unknown> | null,
): HumanChange[] {
  if (!oldObj || !newObj) return [];
  const keys = Array.from(
    new Set<string>([...Object.keys(oldObj), ...Object.keys(newObj)]),
  );
  const out: HumanChange[] = [];
  for (const key of keys) {
    const before = oldObj[key];
    const after = newObj[key];
    // Stable comparison via JSON; safe for these audit payloads.
    let same = false;
    try {
      same = JSON.stringify(before) === JSON.stringify(after);
    } catch {
      same = before === after;
    }
    if (same) continue;
    out.push({
      key,
      label: humanizeKey(key),
      oldText: formatHumanValue(key, before),
      newText: formatHumanValue(key, after),
    });
  }
  return out;
}

export default function UnifiedAuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [range, setRange] = useState<DateRangeValue>(() =>
    resolvePreset("this_month"),
  );
  const [action, setAction] = useState("all");
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const buildParams = useCallback(() => {
    const sp = new URLSearchParams();
    sp.set("from", range.from.toISOString());
    // range.to is end-of-day (….999); +1ms = exclusive upper bound.
    sp.set("to", new Date(range.to.getTime() + 1).toISOString());
    if (action !== "all") sp.set("action", action);
    if (source !== "all") sp.set("source", source);
    if (category !== "all") sp.set("category", category);
    if (search.trim()) sp.set("search", search.trim());
    return sp;
  }, [range, action, source, category, search]);

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
  }, [range, action, source, category, search]);

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
          <DateRangeDropdown onChange={setRange} />
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
            <HumanDiff oldValue={r.old_values} newValue={r.new_values} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function HumanDiff({ oldValue, newValue }: { oldValue: unknown; newValue: unknown }) {
  const oldRec = asRecord(oldValue);
  const newRec = asRecord(newValue);
  const created = !oldRec && !!newRec;
  const deleted = !!oldRec && !newRec;
  const changes = changesBetween(oldRec, newRec);
  const previously = entriesOf(oldRec);
  const now = entriesOf(newRec);

  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        background: "rgba(0,0,0,0.25)",
        padding: "0.9rem 1rem",
        fontFamily: "var(--font-body)",
        color: CREAM,
        fontSize: "0.85rem",
        lineHeight: 1.55,
      }}
    >
      {created ? (
        <DiffSection title="New record created" tone="#4ade80">
          {now.length === 0 ? (
            <PlainLine muted>No fields recorded.</PlainLine>
          ) : (
            <BulletList items={now.map((e) => `${e.label}: ${e.value}`)} />
          )}
        </DiffSection>
      ) : deleted ? (
        <DiffSection title="Record deleted" tone="#ef4444">
          {previously.length === 0 ? (
            <PlainLine muted>No fields recorded.</PlainLine>
          ) : (
            <BulletList items={previously.map((e) => `${e.label}: ${e.value}`)} />
          )}
        </DiffSection>
      ) : (
        <div className="flex flex-col" style={{ gap: "1rem" }}>
          <DiffSection title="What changed" tone={GOLD}>
            {changes.length === 0 ? (
              <PlainLine muted>No field-level differences.</PlainLine>
            ) : (
              <BulletList
                items={changes.map((c) => `${c.label}: ${c.oldText} → ${c.newText}`)}
              />
            )}
          </DiffSection>

          <div
            className="grid"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}
          >
            <DiffSection title="Previously" tone="#ef4444">
              {previously.length === 0 ? (
                <PlainLine muted>(no prior values)</PlainLine>
              ) : (
                <BulletList items={previously.map((e) => `${e.label}: ${e.value}`)} />
              )}
            </DiffSection>
            <DiffSection title="Now" tone="#4ade80">
              {now.length === 0 ? (
                <PlainLine muted>(no current values)</PlainLine>
              ) : (
                <BulletList items={now.map((e) => `${e.label}: ${e.value}`)} />
              )}
            </DiffSection>
          </div>
        </div>
      )}
    </div>
  );
}

function DiffSection({
  title,
  tone,
  children,
}: {
  title: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="uppercase"
        style={{
          color: tone,
          fontFamily: "var(--font-body)",
          fontSize: "0.62rem",
          letterSpacing: "0.22em",
          marginBottom: "0.45rem",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: 0, paddingLeft: "1.1rem", listStyle: "disc" }}>
      {items.map((line, i) => (
        <li key={i} style={{ marginBottom: "0.15rem", wordBreak: "break-word" }}>
          {line}
        </li>
      ))}
    </ul>
  );
}

function PlainLine({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div style={{ color: muted ? FADED : CREAM, fontSize: "0.8rem" }}>{children}</div>
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
    <BrandSelect
      value={value}
      onChange={onChange}
      style={{ minHeight: 0, borderColor: BORDER, textTransform: "capitalize" }}
      options={options.map((o) => ({
        value: o,
        label: o === "all" ? "All" : o,
      }))}
    />
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
