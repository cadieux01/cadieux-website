"use client";

// /admin/audit-log
//
// Read-only operator surface for the site-wide audit log. Wraps the same
// AdminShell every other new admin page uses. Filters:
//   • date range (preset chips + custom range; serialised to ?from=&to=)
//   • entity (multi-select via toggle chips)
//   • action (multi-select via toggle chips)
//   • free-text search across target_label / context / target_id
// All filter changes refetch from /api/admin/audit-log so the result
// reflects the canonical server state, not a stale client cache.
//
// CSV export hits the same route with a high limit and downloads the
// exact filtered result.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import {
  DateRangeDropdown,
  resolvePreset,
  type DateRangeValue,
} from "@/components/admin/DateRangeDropdown";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { csvFilename, downloadCsv, toCsv } from "@/lib/admin-csv";
import { formatDateTime } from "@/lib/admin-formatting";
import {
  AUDIT_ACTION_LABEL,
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  AUDIT_ENTITY_LABEL,
  type AuditAction,
  type AuditEntity,
  type AuditLogRow,
} from "@/lib/audit-log";

const PAGE_SIZE = 100;
const EXPORT_LIMIT = 1000;

const GOLD = "#f59e0b";
const GOLD_SOFT = "rgba(245,158,11,0.85)";
const CREAM = "#fbf3d4";
const FADED = "rgba(192,200,206,0.6)";
const BORDER = "rgba(245,158,11,0.18)";

// Defensive label lookups. If the DB hands back an entity/action value
// the TS union doesn't know about (e.g. a future enum migration that
// shipped server-side before the client rebuild), the bracket index
// returns undefined and React renders the cell silently — but if it
// ever ends up in a non-React-safe position later, we'd crash. Falling
// back to the raw key keeps the row legible.
function entityLabel(e: AuditLogRow["entity"]): string {
  const key = e as keyof typeof AUDIT_ENTITY_LABEL;
  return AUDIT_ENTITY_LABEL[key] ?? String(e ?? "Unknown");
}
function actionLabel(a: AuditLogRow["action"]): string {
  const key = a as keyof typeof AUDIT_ACTION_LABEL;
  return AUDIT_ACTION_LABEL[key] ?? String(a ?? "Unknown");
}

// Meta from Supabase is JSONB so circular refs are impossible, but
// BigInt values or exotic shapes would still throw. Wrap to keep a
// single bad row from crashing the whole table render.
function safeStringifyMeta(meta: unknown, indent?: number): string {
  if (meta == null) return "";
  try {
    return JSON.stringify(meta, null, indent);
  } catch {
    return "(unserializable)";
  }
}

// Convert a DateRange (date-only) to ISO bounds for the server. We
// include the entire end day by passing tomorrow as exclusive upper
// bound so the operator's "today" preset returns rows from today.
function rangeToISO(r: DateRangeValue): { from: string; to: string } {
  return {
    from: r.from.toISOString(),
    // r.to is end-of-day (….999); +1ms gives an exclusive upper bound.
    to: new Date(r.to.getTime() + 1).toISOString(),
  };
}

function buildQuery(
  range: DateRangeValue,
  entities: AuditEntity[],
  actions: AuditAction[],
  q: string,
  limit: number,
  offset: number,
): string {
  const sp = new URLSearchParams();
  const iso = rangeToISO(range);
  if (iso.from) sp.set("from", iso.from);
  if (iso.to) sp.set("to", iso.to);
  for (const e of entities) sp.append("entity", e);
  for (const a of actions) sp.append("action", a);
  if (q.trim()) sp.set("q", q.trim());
  sp.set("limit", String(limit));
  sp.set("offset", String(offset));
  return sp.toString();
}

// Suspense wrapper required by Next.js prerender for any client page
// that reads useSearchParams() — useDateRangeFromQuery does, so the
// boundary lives at the page export.
export default function AuditLogPage() {
  return (
    <Suspense fallback={<AdminLoading />}>
      <AuditLogPageInner />
    </Suspense>
  );
}

function AdminLoading() {
  return (
    <div
      style={{
        padding: "2rem",
        color: "rgba(245,158,11,0.7)",
        fontFamily: "var(--font-body)",
        fontSize: "0.85rem",
        letterSpacing: "0.05em",
      }}
    >
      Loading…
    </div>
  );
}

function AuditLogPageInner() {
  const [range, setRange] = useState<DateRangeValue>(() =>
    resolvePreset("this_month"),
  );

  const [entities, setEntities] = useState<AuditEntity[]>([]);
  const [actions, setActions] = useState<AuditAction[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    // 10s hard timeout. Without this, a hung request (DB down, edge
    // route stuck, missing audit_log table) would leave the page
    // stuck on "Loading…" forever — the symptom that brought us here.
    const ctrl = new AbortController();
    const timeoutId = window.setTimeout(() => ctrl.abort(), 10_000);
    try {
      const qs = buildQuery(range, entities, actions, q, PAGE_SIZE, page * PAGE_SIZE);
      const res = await adminFetch<{ rows: AuditLogRow[]; total: number }>(
        `/api/admin/audit-log?${qs}`,
        { signal: ctrl.signal },
      );
      setRows(res.rows ?? []);
      setTotal(res.total ?? 0);
    } catch (e) {
      const aborted =
        (e instanceof DOMException && e.name === "AbortError") ||
        (e instanceof Error && e.name === "AbortError");
      setErr(
        aborted
          ? "Request timed out after 10s. The audit_log table may be missing, or the server is unreachable."
          : e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
          ? e.message
          : "Failed to load audit log",
      );
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }, [range, entities, actions, q, page]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  // Reset to page 0 whenever a filter changes; load on every change.
  useEffect(() => {
    setPage(0);
  }, [range, entities, actions, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function exportCsv() {
    try {
      const qs = buildQuery(range, entities, actions, q, EXPORT_LIMIT, 0);
      const res = await adminFetch<{ rows: AuditLogRow[]; total: number }>(
        `/api/admin/audit-log?${qs}`,
      );
      const csv = toCsv(res.rows ?? [], [
        { header: "When", value: (r) => r.occurred_at },
        { header: "Entity", value: (r) => entityLabel(r.entity) },
        { header: "Action", value: (r) => actionLabel(r.action) },
        { header: "Target", value: (r) => r.target_label ?? "" },
        { header: "Target ID", value: (r) => r.target_id ?? "" },
        { header: "Context", value: (r) => r.context ?? "" },
        { header: "IP", value: (r) => r.ip_address ?? "" },
        {
          header: "Meta",
          value: (r) => safeStringifyMeta(r.meta),
        },
      ]);
      downloadCsv(csvFilename("audit-log"), csv);
    } catch (e) {
      setErr(e instanceof AdminFetchError ? e.message : "Export failed");
    }
  }

  function toggleEntity(e: AuditEntity) {
    setEntities((cur) =>
      cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e],
    );
  }
  function toggleAction(a: AuditAction) {
    setActions((cur) =>
      cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a],
    );
  }

  const subtitle = useMemo(() => {
    const parts: string[] = [];
    parts.push(`${total} event${total === 1 ? "" : "s"}`);
    if (entities.length) parts.push(`${entities.length} entity filter${entities.length === 1 ? "" : "s"}`);
    if (actions.length) parts.push(`${actions.length} action filter${actions.length === 1 ? "" : "s"}`);
    return parts.join(" · ");
  }, [total, entities.length, actions.length]);

  return (
    <AdminShell
      title="Audit Log"
      subtitle={subtitle}
      actions={
        <>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.7rem",
              letterSpacing: "0.25em",
              color: GOLD,
              border: `1px solid ${GOLD}`,
              padding: "0.45rem 0.9rem",
              background: "transparent",
              cursor: refreshing ? "wait" : "pointer",
              opacity: refreshing ? 0.6 : 1,
            }}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="uppercase"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.7rem",
              letterSpacing: "0.25em",
              color: GOLD,
              border: `1px solid ${GOLD}`,
              padding: "0.45rem 0.9rem",
              background: "transparent",
            }}
          >
            Export CSV
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <DateRangeDropdown onChange={setRange} />

        <FilterChips
          label="Entity"
          options={AUDIT_ENTITIES.map((e) => ({ key: e, label: AUDIT_ENTITY_LABEL[e] }))}
          selected={entities as string[]}
          onToggle={(k) => toggleEntity(k as AuditEntity)}
          onClear={() => setEntities([])}
        />

        <FilterChips
          label="Action"
          options={AUDIT_ACTIONS.map((a) => ({ key: a, label: AUDIT_ACTION_LABEL[a] }))}
          selected={actions as string[]}
          onToggle={(k) => toggleAction(k as AuditAction)}
          onClear={() => setActions([])}
        />

        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search target, context, or ID…"
            className="px-3 py-2"
            style={{
              border: `1px solid ${BORDER}`,
              background: "transparent",
              color: CREAM,
              fontFamily: "var(--font-body)",
              fontSize: "0.85rem",
              minWidth: "260px",
              flex: "1 1 260px",
            }}
          />
          {q ? (
            <button
              type="button"
              onClick={() => setQ("")}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.62rem",
                letterSpacing: "0.22em",
                color: FADED,
                border: `1px solid ${BORDER}`,
                padding: "0.3rem 0.7rem",
                background: "transparent",
              }}
            >
              Clear
            </button>
          ) : null}
        </div>

        {err ? (
          <div
            role="alert"
            style={{
              border: "1px solid rgba(239,68,68,0.55)",
              background: "rgba(239,68,68,0.08)",
              padding: "0.85rem 1rem",
              color: "#fecaca",
              fontFamily: "var(--font-body)",
              fontSize: "0.85rem",
              lineHeight: 1.5,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.75rem",
            }}
          >
            <div style={{ minWidth: 0, flex: "1 1 320px" }}>
              <strong style={{ color: "#fca5a5", letterSpacing: "0.1em" }}>
                Couldn’t load audit log:
              </strong>{" "}
              {err}
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="uppercase"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.65rem",
                letterSpacing: "0.22em",
                color: "#fecaca",
                border: "1px solid rgba(254,202,202,0.6)",
                padding: "0.4rem 0.85rem",
                background: "transparent",
                cursor: loading ? "wait" : "pointer",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? "Retrying…" : "Retry"}
            </button>
          </div>
        ) : null}

        <div
          style={{
            border: `1px solid ${BORDER}`,
            background: "rgba(0,0,0,0.18)",
          }}
        >
          <div
            className="overflow-x-auto"
            style={{ scrollbarWidth: "thin" }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontFamily: "var(--font-body)",
                color: CREAM,
                fontSize: "0.82rem",
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
                  <th style={th}>When</th>
                  <th style={th}>Entity</th>
                  <th style={th}>Action</th>
                  <th style={th}>Target</th>
                  <th style={th}>Context</th>
                  <th style={th}>IP</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} style={{ ...td, color: FADED }}>
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ ...td, color: FADED }}>
                      No events match the current filters.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr
                      key={r.id}
                      style={{
                        borderTop: `1px solid ${BORDER}`,
                      }}
                    >
                      <td style={td}>{formatDateTime(r.occurred_at)}</td>
                      <td style={td}>{entityLabel(r.entity)}</td>
                      <td style={td}>{actionLabel(r.action)}</td>
                      <td style={td}>
                        <div style={{ color: CREAM }}>
                          {r.target_label || "—"}
                        </div>
                        {r.target_id ? (
                          <div
                            style={{
                              color: FADED,
                              fontSize: "0.7rem",
                              wordBreak: "break-all",
                            }}
                          >
                            {r.target_id}
                          </div>
                        ) : null}
                      </td>
                      <td style={td}>
                        <div style={{ color: CREAM }}>
                          {r.context || "—"}
                        </div>
                        {r.meta ? (
                          <details style={{ marginTop: "0.25rem" }}>
                            <summary
                              style={{
                                color: GOLD_SOFT,
                                fontSize: "0.65rem",
                                letterSpacing: "0.18em",
                                textTransform: "uppercase",
                                cursor: "pointer",
                              }}
                            >
                              Details
                            </summary>
                            <pre
                              style={{
                                color: FADED,
                                fontSize: "0.72rem",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-all",
                                marginTop: "0.25rem",
                              }}
                            >
                              {safeStringifyMeta(r.meta, 2)}
                            </pre>
                          </details>
                        ) : null}
                      </td>
                      <td style={{ ...td, color: FADED, fontSize: "0.72rem" }}>
                        {r.ip_address || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <span style={{ color: FADED, fontSize: "0.75rem" }}>
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="uppercase"
              style={{
                ...pagerBtn,
                opacity: page === 0 || loading ? 0.45 : 1,
              }}
            >
              ← Newer
            </button>
            <button
              type="button"
              disabled={page + 1 >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="uppercase"
              style={{
                ...pagerBtn,
                opacity: page + 1 >= totalPages || loading ? 0.45 : 1,
              }}
            >
              Older →
            </button>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

function FilterChips({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  options: { key: string; label: string }[];
  selected: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span
        style={{
          color: FADED,
          fontSize: "0.65rem",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          minWidth: "70px",
        }}
      >
        {label}
      </span>
      {options.map((o) => {
        const active = selected.includes(o.key);
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onToggle(o.key)}
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
            {o.label}
          </button>
        );
      })}
      {selected.length > 0 ? (
        <button
          type="button"
          onClick={onClear}
          className="uppercase"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.6rem",
            letterSpacing: "0.22em",
            color: FADED,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          Clear
        </button>
      ) : null}
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
