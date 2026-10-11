"use client";

// /admin/audit — UNIFIED audit trail.
//
// Reads logistics.audit_logs (the cross-panel log fed by the dashboard,
// the public-schema triggers, and sensitive-mutation gating) via
// /api/admin/audit. Distinct from /admin/audit-log, which reads the
// website-only public.audit_log table.
//
// Read-only + immutable: no edit/delete affordances anywhere; CSV export
// only. Filters (date / source / action / category / search) are applied
// server-side, and so is PAGINATION: one 50-row window per request, with
// the row count taken from the server's exact count rather than from the
// length of what came back.
//
// It used to say "the returned rows (≤2000)" and slice them in the browser.
// Both halves of that were wrong: PostgREST caps a response at 1000, so a
// busy range quietly produced 1000 rows that the page then reported as the
// total. See MAX_ROWS in api/admin/audit for the full account.

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
import { resolveExportScope } from "@/lib/export-scope";

const CREAM_SOFT = "rgba(251,243,212,0.85)";
const CREAM = "#FBF3D4";
const PANEL_BORDER = "rgba(251,243,212,0.35)";
const FADED = "rgba(251,243,212,0.6)";
const BORDER = "rgba(251,243,212,0.18)";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const PER_PAGE = 50;

/** Rows per request when the CSV export pages the whole filtered set.
 *  Matches MAX_ROWS in api/admin/audit — PostgREST will not return more
 *  than this however large a limit we send, so asking for more would only
 *  make the loop think it had finished early. */
const EXPORT_CHUNK = 1000;

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
      return "#FBF3D4";
    case "UPDATE":
      return CREAM;
    case "DELETE":
      return "#EF4444";
    case "LOGIN":
      return "#FBF3D4";
    case "BLOCKED":
      return "#FBF3D4";
    case "LOCKOUT":
      return "#EF4444";
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
  // Rows MATCHING THE FILTERS server-side, not rows loaded. The gap between
  // the two is the whole point — see `load`.
  const [total, setTotal] = useState(0);
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

  // ONE PAGE PER REQUEST, AND THE SERVER'S OWN COUNT.
  //
  // This used to ask for every matching row and slice the result 50 at a
  // time in the browser. PostgREST caps a response at 1000 rows, so on any
  // range busier than that the page silently held the newest 1000 and
  // called it the total: "1000 events", "Showing 1-50 of 1000", and a CSV
  // of 1000 — over a filtered set that is really 7,224. Nothing on screen
  // said so, which is what made it dangerous rather than merely wrong.
  //
  // Now the bound is a WINDOW, not a ceiling: `offset` moves it, and
  // `total` comes from the server's exact count, so every row is reachable
  // and the number shown is the real one.
  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const sp = buildParams();
      sp.set("limit", String(PER_PAGE));
      sp.set("offset", String((page - 1) * PER_PAGE));
      const res = await adminFetch<{ rows: AuditRow[]; total: number }>(
        `/api/admin/audit?${sp.toString()}`,
      );
      setRows(res.rows ?? []);
      setTotal(res.total ?? 0);
    } catch (e) {
      setError(
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
          ? e.message
          : "Failed to load audit trail",
      );
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [buildParams, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Filters reset to page 1. `load` depends on `page`, so this must run
  // before it to avoid fetching an offset the new filter has no rows for.
  useEffect(() => {
    setPage(1);
  }, [range, action, source, category, search]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const pageRows = rows;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  // THE FILE IS THE WHOLE FILTERED SET, NOT THE PAGE ON SCREEN.
  //
  // `rows` is now 50 rows, so exporting it would write a 50-row file — the
  // 250-of-718 bug again, just smaller. lib/export-scope.ts already decides
  // this question: hand it the loaded rows, the server's total and whether
  // the view is bounded, and it re-fetches when it has to and returns a
  // sentence stating what the file covers.
  //
  // `fetchAll` pages the API in MAX chunks because PostgREST will not
  // return more than 1000 rows per request however large a limit we send.
  // `applyFilters` is identity: every filter on this page is applied
  // server-side via buildParams, so the re-fetch is already scoped and
  // re-filtering in the browser could only ever diverge from it.
  const [exporting, setExporting] = useState(false);

  async function exportCsv() {
    setExporting(true);
    setError(null);
    try {
      const scope = await resolveExportScope<AuditRow>({
        loaded: rows,
        total,
        truncated: total > rows.length,
        label: "events",
        fetchAll: async () => {
          const all: AuditRow[] = [];
          for (let offset = 0; offset < total; offset += EXPORT_CHUNK) {
            const sp = buildParams();
            sp.set("limit", String(EXPORT_CHUNK));
            sp.set("offset", String(offset));
            const res = await adminFetch<{ rows: AuditRow[]; total: number }>(
              `/api/admin/audit?${sp.toString()}`,
            );
            const batch = res.rows ?? [];
            all.push(...batch);
            // A short chunk means the server has no more to give. Without
            // this the loop would spin to `total` against a moving table.
            if (batch.length < EXPORT_CHUNK) break;
          }
          return all;
        },
        applyFilters: (r) => r,
      });

      const csv = toCsv(scope.rows, [
        { header: "Timestamp", value: (r) => r.created_at },
        { header: "Source", value: (r) => r.source ?? "" },
        { header: "User", value: (r) => r.user_name ?? "" },
        { header: "Action", value: (r) => r.action_type ?? "" },
        { header: "Category", value: (r) => r.category ?? "" },
        { header: "Entity", value: (r) => r.entity_type ?? "" },
        { header: "Description", value: (r) => r.description ?? "" },
        { header: "Before", value: (r) => safeJson(r.old_values, 0) },
        { header: "After", value: (r) => safeJson(r.new_values, 0) },
        // Carried in the file itself, because a CSV outlives the screen it
        // was downloaded from.
        { header: "Scope", value: () => scope.note },
      ]);
      downloadCsv(
        csvFilename(`audit-trail-${scope.rows.length}-of-${total}`),
        csv,
      );
    } catch (e) {
      // Nothing is written on failure: a partial audit export is the exact
      // thing this path exists to prevent.
      setError(
        e instanceof AdminFetchError
          ? `Export failed (${e.message}). Nothing was downloaded.`
          : "Export failed — nothing was downloaded. Try again.",
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <AdminShell
      title="Audit Trail"
      subtitle={`${total} event${total === 1 ? "" : "s"} · all panels`}
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
          <button
            type="button"
            onClick={() => void exportCsv()}
            disabled={exporting || total === 0}
            className="uppercase"
            style={{
              ...chipBtn,
              cursor: exporting ? "wait" : "pointer",
              opacity: exporting || total === 0 ? 0.6 : 1,
            }}
          >
            {/* The export now re-fetches, so it is no longer instant on a
                large range. Saying so beats a button that looks ignored. */}
            {exporting ? "Preparing…" : "Export CSV"}
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
          border: `1px solid ${PANEL_BORDER}`,
          background: "rgba(251,243,212,0.06)",
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
            fontSize: "1rem",
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
              fontSize: "1rem",
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
            color: "#EF4444",
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
            marginBottom: "1rem",
          }}
        >
          {error}
        </div>
      ) : null}

      <div style={{ border: `1px solid ${BORDER}`, background: "rgba(29,29,31,0.18)" }}>
        <div className="overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
          <table
            style={{
              width: "100%",
              minWidth: 920,
              borderCollapse: "collapse",
              fontFamily: MONO,
              color: CREAM,
              fontSize: "1rem",
            }}
          >
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  color: CREAM_SOFT,
                  fontSize: "0.875rem",
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
                    idx % 2 === 0 ? "transparent" : "rgba(251,243,212,0.04)";
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
        <span style={{ color: FADED, fontSize: "1rem", fontFamily: "var(--font-body)" }}>
          {total === 0
            ? "No events"
            : `Showing ${(page - 1) * PER_PAGE + 1}–${(page - 1) * PER_PAGE + rows.length} of ${total}`}
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
          <span style={{ color: FADED, fontSize: "1rem", alignSelf: "center", fontFamily: "var(--font-body)" }}>
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
            <div style={{ color: FADED, fontSize: "1rem", wordBreak: "break-all", marginTop: 2 }}>
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
                fontSize: "0.875rem",
                letterSpacing: "0.18em",
                color: CREAM_SOFT,
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
        <tr style={{ background: "rgba(29,29,31,0.3)" }}>
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
        background: "rgba(29,29,31,0.25)",
        padding: "0.9rem 1rem",
        fontFamily: "var(--font-body)",
        color: CREAM,
        fontSize: "1rem",
        lineHeight: 1.55,
      }}
    >
      {created ? (
        <DiffSection title="New record created" tone="#FBF3D4">
          {now.length === 0 ? (
            <PlainLine muted>No fields recorded.</PlainLine>
          ) : (
            <BulletList items={now.map((e) => `${e.label}: ${e.value}`)} />
          )}
        </DiffSection>
      ) : deleted ? (
        <DiffSection title="Record deleted" tone="#EF4444">
          {previously.length === 0 ? (
            <PlainLine muted>No fields recorded.</PlainLine>
          ) : (
            <BulletList items={previously.map((e) => `${e.label}: ${e.value}`)} />
          )}
        </DiffSection>
      ) : (
        <div className="flex flex-col" style={{ gap: "1rem" }}>
          <DiffSection title="What changed" tone={CREAM}>
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
            <DiffSection title="Previously" tone="#EF4444">
              {previously.length === 0 ? (
                <PlainLine muted>(no prior values)</PlainLine>
              ) : (
                <BulletList items={previously.map((e) => `${e.label}: ${e.value}`)} />
              )}
            </DiffSection>
            <DiffSection title="Now" tone="#FBF3D4">
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
          fontSize: "0.875rem",
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
    <div style={{ color: muted ? FADED : CREAM, fontSize: "1rem" }}>{children}</div>
  );
}

function SourceBadge({ source }: { source: string | null }) {
  const isWebsite = source === "website";
  const color = isWebsite ? "#FBF3D4" : CREAM;
  const label = source || "—";
  return (
    <span
      className="uppercase"
      style={{
        fontFamily: "var(--font-body)",
        fontSize: "0.875rem",
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
        fontSize: "0.875rem",
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
  fontSize: "0.875rem",
  letterSpacing: "0.25em",
  color: CREAM,
  border: `1px solid ${CREAM}`,
  padding: "0.45rem 0.9rem",
  background: "transparent",
};
const pagerBtn: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
  padding: "0.35rem 0.85rem",
  color: CREAM_SOFT,
  background: "transparent",
  border: `1px solid ${BORDER}`,
  cursor: "pointer",
};
