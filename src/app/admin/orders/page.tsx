"use client";

// Today's Orders — operational view used during dispatch hours.
//
// Reads /api/admin/orders (admin-token-gated GET) and lets the operator
// filter by status, search by customer name/phone, sort by created_at
// or by delivery_date, and run per-row PATCH actions that match the
// transitions the existing /api/admin/orders/[id] endpoint accepts.
//
// Live columns surfaced (post the orders.delivery_date + items
// migration): delivery_date, delivery_slot, items jsonb. Rows that
// predate the migration (where these are null) fall back to created_at
// for the "Delivery" column and a single-line "—" for items.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import {
  DateRangePicker,
  useDateRangeFromQuery,
  withinRange,
} from "@/components/admin/DateRangePicker";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { csvFilename, downloadCsv, toCsv } from "@/lib/admin-csv";
import {
  formatDate,
  formatDateTime,
  formatINR,
  telHref,
} from "@/lib/admin-formatting";
import {
  AdminOrderRow,
  ORDER_FILTER_VALUES,
  OrderFilterValue,
  OrderStatus,
} from "@/lib/admin-shared";

type SortKey = "created_desc" | "delivery_asc";

const NEXT_STATUS_FOR: Record<string, OrderStatus | null> = {
  pending_payment: "confirmed",
  pending: "confirmed",
  confirmed: "dispatched",
  dispatched: "delivered",
  delivered: null,
  cancelled: null,
};

type BulkAction = "confirm" | "dispatch" | "deliver" | "cancel";

type BulkResult = {
  succeeded: string[];
  failed: { id: string; error: string }[];
  action: BulkAction;
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<OrderFilterValue>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("created_desc");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingBulk, setPendingBulk] = useState<BulkAction | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const range = useDateRangeFromQuery();

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await adminFetch<{ orders: AdminOrderRow[] }>(
        "/api/admin/orders",
      );
      setOrders(res.orders ?? []);
    } catch (e) {
      if (e instanceof AdminFetchError) setError(e.message);
      else setError("Could not load orders.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders
      .filter((o) => {
        if (!withinRange(o.created_at, range)) return false;
        if (filter !== "all") {
          if ((o.status ?? "").toLowerCase() !== filter) return false;
        }
        if (!q) return true;
        const name = (o.customers?.full_name ?? "").toLowerCase();
        const phone = (o.customers?.phone ?? "").toLowerCase();
        return name.includes(q) || phone.includes(q);
      })
      .sort((a, b) => {
        if (sort === "delivery_asc") {
          // delivery_date is YYYY-MM-DD (lex-sortable). Rows that
          // predate the migration fall back to created_at so they
          // still appear at a stable position in the queue.
          const aKey = a.delivery_date ?? a.created_at.slice(0, 10);
          const bKey = b.delivery_date ?? b.created_at.slice(0, 10);
          const cmp = aKey.localeCompare(bKey);
          if (cmp !== 0) return cmp;
          // Tie-break by slot then created_at so packing groups stay
          // contiguous within a day.
          const aSlot = a.delivery_slot ?? "";
          const bSlot = b.delivery_slot ?? "";
          const slotCmp = aSlot.localeCompare(bSlot);
          if (slotCmp !== 0) return slotCmp;
          return a.created_at.localeCompare(b.created_at);
        }
        return b.created_at.localeCompare(a.created_at);
      });
  }, [orders, filter, query, sort, range]);

  // Counts are scoped to the active date range so the chip badges
  // match the rows the operator is actually looking at.
  const counts = useMemo(() => {
    const inRange = orders.filter((o) => withinRange(o.created_at, range));
    const c: Record<string, number> = { all: inRange.length };
    for (const o of inRange) {
      const k = (o.status ?? "").toLowerCase();
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [orders, range]);

  const advance = async (order: AdminOrderRow) => {
    const next = NEXT_STATUS_FOR[(order.status ?? "").toLowerCase()];
    if (!next) return;
    await patchStatus(order, next);
  };

  const toggleSelect = (id: string) => {
    setSelected((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const masterChecked =
    filtered.length > 0 && filtered.every((o) => selected.has(o.id));
  const someSelected = filtered.some((o) => selected.has(o.id));

  const toggleSelectAll = () => {
    setSelected((curr) => {
      if (masterChecked) {
        // Clear only the currently-visible ids so selections on other
        // filters aren't lost when the operator toggles.
        const next = new Set(curr);
        for (const o of filtered) next.delete(o.id);
        return next;
      }
      const next = new Set(curr);
      for (const o of filtered) next.add(o.id);
      return next;
    });
  };

  const runBulk = async (action: BulkAction) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkRunning(true);
    try {
      const res = await adminFetch<{
        succeeded: string[];
        failed: { id: string; error: string }[];
      }>("/api/admin/orders/bulk", {
        method: "POST",
        body: JSON.stringify({ orderIds: ids, action }),
      });
      setBulkResult({ ...res, action });
      // Drop succeeded ids from selection and refetch so the UI matches
      // the canonical server state.
      setSelected((curr) => {
        const next = new Set(curr);
        for (const id of res.succeeded) next.delete(id);
        return next;
      });
      await load();
    } catch (e) {
      const msg =
        e instanceof AdminFetchError ? e.message : "Bulk action failed.";
      setBulkResult({ succeeded: [], failed: ids.map((id) => ({ id, error: msg })), action });
    } finally {
      setBulkRunning(false);
      setPendingBulk(null);
    }
  };

  const patchStatus = async (order: AdminOrderRow, next: OrderStatus) => {
    setBusyId(order.id);
    // Optimistic — flip the status locally and roll back on failure.
    const prev = orders;
    setOrders((curr) =>
      curr.map((o) => (o.id === order.id ? { ...o, status: next } : o)),
    );
    try {
      await adminFetch(`/api/admin/orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
    } catch (e) {
      setOrders(prev);
      if (e instanceof AdminFetchError) {
        alert(e.message);
      } else {
        alert("Update failed.");
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminShell
      title="Today's Orders"
      subtitle="Operational queue"
      actions={
        <>
          <Link
            href={{
              pathname: "/admin/orders/print",
              query: { status: filter, q: query, sort },
            }}
            className="uppercase"
            style={chipPrimary}
          >
            Print packing list
          </Link>
          <button
            type="button"
            onClick={() => exportCsv(filtered)}
            className="uppercase"
            style={chipNeutral}
            disabled={filtered.length === 0}
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="uppercase"
            style={chipNeutral}
          >
            Refresh
          </button>
        </>
      }
    >
      <div className="mb-4">
        <DateRangePicker value={range} />
      </div>

      {/* Status filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {ORDER_FILTER_VALUES.map((v) => {
          const count = counts[v] ?? 0;
          const active = v === filter;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setFilter(v)}
              className="uppercase"
              style={{
                ...chipBase,
                color: active ? "#06120c" : "rgba(245,158,11,0.85)",
                background: active ? "#f59e0b" : "transparent",
                borderColor: active ? "#f59e0b" : "rgba(245,158,11,0.4)",
              }}
            >
              {v.replace(/_/g, " ")}
              <span style={{ marginLeft: 8, opacity: 0.7 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Search + sort */}
      <div className="flex flex-wrap gap-3 items-center mb-6">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or phone"
          className="px-3 py-2 bg-transparent outline-none"
          style={{
            border: "1px solid rgba(245,158,11,0.3)",
            color: "#fbf3d4",
            fontFamily: "var(--font-body)",
            fontSize: "0.85rem",
            letterSpacing: "0.05em",
            minWidth: 240,
          }}
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="px-3 py-2 bg-transparent uppercase"
          style={{
            border: "1px solid rgba(245,158,11,0.3)",
            color: "#fbf3d4",
            fontFamily: "var(--font-body)",
            fontSize: "0.7rem",
            letterSpacing: "0.2em",
          }}
        >
          <option value="created_desc" style={{ color: "#000" }}>
            Newest first
          </option>
          <option value="delivery_asc" style={{ color: "#000" }}>
            Delivery date ↑
          </option>
        </select>
      </div>

      {selected.size > 0 ? (
        <BulkToolbar
          count={selected.size}
          running={bulkRunning}
          onClear={() => setSelected(new Set())}
          onAction={(a) => setPendingBulk(a)}
        />
      ) : null}

      {pendingBulk ? (
        <ConfirmModal
          action={pendingBulk}
          count={selected.size}
          running={bulkRunning}
          onCancel={() => setPendingBulk(null)}
          onConfirm={() => void runBulk(pendingBulk)}
        />
      ) : null}

      {bulkResult ? (
        <ResultModal result={bulkResult} onClose={() => setBulkResult(null)} />
      ) : null}

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {loading ? (
        <Placeholder>Loading orders…</Placeholder>
      ) : filtered.length === 0 ? (
        <Placeholder>No orders match the current filters.</Placeholder>
      ) : (
        <div
          style={{
            border: "1px solid rgba(245,158,11,0.18)",
            borderRadius: 6,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={tableHeadRow}>
                <th style={{ ...th, width: 36 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all visible orders"
                    checked={masterChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = !masterChecked && someSelected;
                    }}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th style={th}>Order</th>
                <th style={th}>Customer</th>
                <th style={th}>Total</th>
                <th style={th}>Status</th>
                <th style={th}>Delivery</th>
                <th style={th}>Created</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o, i) => {
                const next = NEXT_STATUS_FOR[(o.status ?? "").toLowerCase()];
                const busy = busyId === o.id;
                return (
                  <tr
                    key={o.id}
                    style={{
                      background:
                        i % 2 === 0
                          ? "rgba(245,158,11,0.025)"
                          : "transparent",
                    }}
                  >
                    <td style={td}>
                      <input
                        type="checkbox"
                        aria-label={`Select order ${o.id}`}
                        checked={selected.has(o.id)}
                        onChange={() => toggleSelect(o.id)}
                      />
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          fontFamily: "var(--font-body)",
                          fontSize: "0.7rem",
                          letterSpacing: "0.1em",
                          color: "#fbf3d4",
                        }}
                        title={o.id}
                      >
                        #{o.id.slice(0, 8)}
                      </span>
                    </td>
                    <td style={td}>
                      <div style={{ color: "#fbf3d4", fontSize: "0.85rem" }}>
                        {o.customers?.full_name ?? "—"}
                      </div>
                      {o.customers?.phone ? (
                        <a
                          href={telHref(o.customers.phone)}
                          style={{
                            color: "rgba(245,158,11,0.85)",
                            fontSize: "0.75rem",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {o.customers.phone}
                        </a>
                      ) : null}
                    </td>
                    <td style={td}>
                      <span style={{ color: "#fbf3d4", fontSize: "0.85rem" }}>
                        {formatINR(o.total_amount)}
                      </span>
                    </td>
                    <td style={td}>
                      <StatusBadge status={o.status} />
                    </td>
                    <td style={td}>
                      <div style={{ color: "#fbf3d4", fontSize: "0.8rem" }}>
                        {o.delivery_date ? formatDate(o.delivery_date) : "—"}
                      </div>
                      {o.delivery_slot ? (
                        <div
                          style={{
                            color: "rgba(192,200,206,0.65)",
                            fontSize: "0.7rem",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {o.delivery_slot}
                        </div>
                      ) : null}
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          color: "rgba(192,200,206,0.7)",
                          fontSize: "0.75rem",
                        }}
                      >
                        {formatDateTime(o.created_at)}
                      </span>
                    </td>
                    <td style={td}>
                      <div className="flex flex-wrap gap-2">
                        {next ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void advance(o)}
                            style={{
                              ...buttonSm,
                              opacity: busy ? 0.5 : 1,
                            }}
                          >
                            Mark {next}
                          </button>
                        ) : null}
                        {o.status !== "cancelled" && o.status !== "delivered" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (confirm("Cancel this order?")) {
                                void patchStatus(o, "cancelled");
                              }
                            }}
                            style={{
                              ...buttonSm,
                              color: "#ef4444",
                              borderColor: "rgba(239,68,68,0.45)",
                              opacity: busy ? 0.5 : 1,
                            }}
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}

const ACTION_LABEL: Record<BulkAction, string> = {
  confirm: "Mark confirmed",
  dispatch: "Mark dispatched",
  deliver: "Mark delivered",
  cancel: "Cancel",
};

const ACTION_PAST: Record<BulkAction, string> = {
  confirm: "confirmed",
  dispatch: "dispatched",
  deliver: "delivered",
  cancel: "cancelled",
};

function BulkToolbar({
  count,
  running,
  onClear,
  onAction,
}: {
  count: number;
  running: boolean;
  onClear: () => void;
  onAction: (a: BulkAction) => void;
}) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 5,
        display: "flex",
        flexWrap: "wrap",
        gap: "0.6rem",
        alignItems: "center",
        background: "rgba(245,158,11,0.1)",
        border: "1px solid rgba(245,158,11,0.4)",
        padding: "0.6rem 0.9rem",
        marginBottom: "1rem",
      }}
    >
      <span
        style={{
          color: "#fbf3d4",
          fontFamily: "var(--font-body)",
          fontSize: "0.78rem",
          letterSpacing: "0.05em",
        }}
      >
        {count} selected
      </span>
      <span style={{ flex: 1 }} />
      {(Object.keys(ACTION_LABEL) as BulkAction[]).map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => onAction(a)}
          disabled={running}
          style={{
            ...bulkButton,
            color: a === "cancel" ? "#ef4444" : "#f59e0b",
            borderColor:
              a === "cancel"
                ? "rgba(239,68,68,0.45)"
                : "rgba(245,158,11,0.45)",
            opacity: running ? 0.5 : 1,
          }}
        >
          {ACTION_LABEL[a]}
        </button>
      ))}
      <button
        type="button"
        onClick={onClear}
        disabled={running}
        style={{
          ...bulkButton,
          color: "rgba(192,200,206,0.65)",
          borderColor: "rgba(192,200,206,0.3)",
        }}
      >
        Clear
      </button>
    </div>
  );
}

function ConfirmModal({
  action,
  count,
  running,
  onCancel,
  onConfirm,
}: {
  action: BulkAction;
  count: number;
  running: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div style={modalBackdrop} onClick={running ? undefined : onCancel}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <h3 style={modalTitle}>
          {ACTION_LABEL[action]} · {count} order{count === 1 ? "" : "s"}?
        </h3>
        <p style={modalBody}>
          {action === "cancel"
            ? `This will mark ${count} order${count === 1 ? "" : "s"} as cancelled. The customer will receive a push notification. This cannot be undone via the admin UI.`
            : `${count} order${count === 1 ? "" : "s"} will be marked as ${ACTION_PAST[action]} and the customers notified.`}
        </p>
        <div style={modalActions}>
          <button
            type="button"
            onClick={onCancel}
            disabled={running}
            style={chipNeutral}
          >
            Back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={running}
            style={{
              ...chipPrimary,
              background: action === "cancel" ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)",
              borderColor:
                action === "cancel"
                  ? "rgba(239,68,68,0.6)"
                  : "rgba(245,158,11,0.6)",
              color: action === "cancel" ? "#fca5a5" : "#f59e0b",
              opacity: running ? 0.6 : 1,
            }}
          >
            {running ? "Working…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultModal({
  result,
  onClose,
}: {
  result: BulkResult;
  onClose: () => void;
}) {
  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <h3 style={modalTitle}>Bulk {ACTION_PAST[result.action]} complete</h3>
        <p style={modalBody}>
          {result.succeeded.length} succeeded · {result.failed.length} failed
        </p>
        {result.failed.length > 0 ? (
          <ul
            style={{
              maxHeight: 220,
              overflowY: "auto",
              border: "1px solid rgba(239,68,68,0.35)",
              padding: "0.5rem 0.8rem",
              color: "#fca5a5",
              fontFamily: "var(--font-body)",
              fontSize: "0.78rem",
              listStyle: "none",
              margin: "0 0 1rem",
            }}
          >
            {result.failed.map((f) => (
              <li key={f.id} style={{ padding: "0.2rem 0" }}>
                #{f.id.slice(0, 8)} — {f.error}
              </li>
            ))}
          </ul>
        ) : null}
        <div style={modalActions}>
          <button type="button" onClick={onClose} style={chipPrimary}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function exportCsv(rows: AdminOrderRow[]): void {
  const csv = toCsv(rows, [
    { header: "Order ID", value: (o) => o.id },
    { header: "Customer", value: (o) => o.customers?.full_name ?? "" },
    { header: "Phone", value: (o) => o.customers?.phone ?? "" },
    { header: "Total", value: (o) => o.total_amount ?? 0 },
    { header: "Status", value: (o) => o.status ?? "" },
    { header: "Delivery date", value: (o) => o.delivery_date ?? "" },
    { header: "Delivery slot", value: (o) => o.delivery_slot ?? "" },
    { header: "Delivery address", value: (o) => o.delivery_address ?? "" },
    { header: "Created", value: (o) => o.created_at },
  ]);
  downloadCsv(csvFilename("orders"), csv);
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px dashed rgba(245,158,11,0.2)",
        padding: "3rem 1rem",
        textAlign: "center",
        color: "rgba(192,200,206,0.55)",
        fontFamily: "var(--font-body)",
        fontSize: "0.85rem",
        letterSpacing: "0.05em",
      }}
    >
      {children}
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid rgba(239,68,68,0.45)",
        background: "rgba(239,68,68,0.06)",
        padding: "0.8rem 1rem",
        marginBottom: "1rem",
        color: "#fca5a5",
        fontFamily: "var(--font-body)",
        fontSize: "0.85rem",
        display: "flex",
        gap: "1rem",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <span>{message}</span>
      <button type="button" onClick={onRetry} style={buttonSm}>
        Retry
      </button>
    </div>
  );
}

const chipBase: React.CSSProperties = {
  padding: "0.35rem 0.85rem",
  border: "1px solid rgba(245,158,11,0.4)",
  fontFamily: "var(--font-body)",
  fontSize: "0.65rem",
  letterSpacing: "0.22em",
  background: "transparent",
  cursor: "pointer",
};

const chipPrimary: React.CSSProperties = {
  ...chipBase,
  color: "#f59e0b",
  borderColor: "rgba(245,158,11,0.55)",
  display: "inline-block",
  textDecoration: "none",
};

const chipNeutral: React.CSSProperties = {
  ...chipBase,
  color: "rgba(245,158,11,0.85)",
};

const tableHeadRow: React.CSSProperties = {
  background: "rgba(245,158,11,0.08)",
  color: "rgba(245,158,11,0.9)",
  textTransform: "uppercase",
  fontSize: "0.6rem",
  letterSpacing: "0.22em",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "0.7rem 1rem",
  fontFamily: "var(--font-body)",
  fontWeight: 400,
  borderBottom: "1px solid rgba(245,158,11,0.15)",
};

const td: React.CSSProperties = {
  padding: "0.7rem 1rem",
  fontFamily: "var(--font-body)",
  verticalAlign: "top",
  borderBottom: "1px solid rgba(245,158,11,0.06)",
};

const buttonSm: React.CSSProperties = {
  padding: "0.3rem 0.7rem",
  background: "transparent",
  border: "1px solid rgba(245,158,11,0.45)",
  color: "#f59e0b",
  fontFamily: "var(--font-body)",
  fontSize: "0.62rem",
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  cursor: "pointer",
};

const bulkButton: React.CSSProperties = {
  padding: "0.4rem 0.85rem",
  background: "transparent",
  border: "1px solid rgba(245,158,11,0.45)",
  fontFamily: "var(--font-body)",
  fontSize: "0.65rem",
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  cursor: "pointer",
};

const modalBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(6,4,2,0.78)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
  padding: "1rem",
};

const modalCard: React.CSSProperties = {
  width: "100%",
  maxWidth: 460,
  background: "rgb(12,8,4)",
  border: "1px solid rgba(245,158,11,0.4)",
  padding: "1.4rem 1.4rem 1.2rem",
  borderRadius: 6,
};

const modalTitle: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontSize: "1.05rem",
  color: "#fbf3d4",
  margin: "0 0 0.7rem",
  letterSpacing: "0.04em",
};

const modalBody: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.85rem",
  color: "rgba(192,200,206,0.85)",
  lineHeight: 1.5,
  margin: "0 0 1.2rem",
};

const modalActions: React.CSSProperties = {
  display: "flex",
  gap: "0.6rem",
  justifyContent: "flex-end",
};
