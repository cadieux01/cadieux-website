"use client";

// Today's Orders — operational view used during dispatch hours.
//
// Reads /api/admin/orders (admin-token-gated GET) and lets the operator
// filter by status, search by customer name/phone, sort by created_at
// or by a (placeholder) delivery date, and run per-row PATCH actions
// that match the transitions the existing /api/admin/orders/[id]
// endpoint accepts.
//
// Two known gaps versus the original spec, surfaced explicitly so the
// operator isn't surprised:
//   - The `orders` table has no `delivery_date` or `delivery_slot`
//     column. The "Delivery" column shows `created_at` instead and the
//     sort flip is a no-op. Adding those columns is a separate task.
//   - The `orders` table has no `items` column. The "Items" cell shows
//     "—" today. Hooking it up requires either a new `order_items`
//     table or a JSON column on `orders`.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatDateTime, formatINR, telHref } from "@/lib/admin-formatting";
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

export default function OrdersPage() {
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<OrderFilterValue>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("created_desc");
  const [busyId, setBusyId] = useState<string | null>(null);

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
          // Falls back to created_at since no delivery_date column
          // exists yet. See file header note.
          return a.created_at.localeCompare(b.created_at);
        }
        return b.created_at.localeCompare(a.created_at);
      });
  }, [orders, filter, query, sort]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length };
    for (const o of orders) {
      const k = (o.status ?? "").toLowerCase();
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [orders]);

  const advance = async (order: AdminOrderRow) => {
    const next = NEXT_STATUS_FOR[(order.status ?? "").toLowerCase()];
    if (!next) return;
    await patchStatus(order, next);
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
            onClick={() => void load()}
            className="uppercase"
            style={chipNeutral}
          >
            Refresh
          </button>
        </>
      }
    >
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
            Oldest first
          </option>
        </select>
      </div>

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
                <th style={th}>Order</th>
                <th style={th}>Customer</th>
                <th style={th}>Total</th>
                <th style={th}>Status</th>
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
