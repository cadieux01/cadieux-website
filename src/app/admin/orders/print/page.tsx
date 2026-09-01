"use client";

// Print-friendly orders sheet. Renders the same filter set as
// /admin/orders (status, q, sort, from, to — all carried in query
// params) and triggers window.print() once loaded.
//
// The date range comes from the DateRangeDropdown on the orders page:
// ?from=YYYY-MM-DD&to=YYYY-MM-DD (local dates). Filtered inclusively
// on created_at so the printed sheet matches the on-screen table
// exactly.
//
// Rows are grouped first by delivery_date then by delivery_slot so the
// kitchen can pack each route slot in one pass. Orders missing either
// field (web checkout flow, legacy rows) fall into the "Undated" /
// "No slot" buckets at the end.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import {
  withinDateRange,
  type DateRangeValue,
} from "@/components/admin/DateRangeDropdown";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatDate, formatDateTime, formatINR } from "@/lib/admin-formatting";
import {
  AdminOrderItemSnapshot,
  AdminOrderRow,
  OrderFilterValue,
} from "@/lib/admin-shared";

// Parse a YYYY-MM-DD string (from the orders page's toYMD) as a local
// Date. Invalid / missing → null. Mirrors DateRangeDropdown's own
// parser — kept private here to avoid enlarging its exported API.
function parseYmdLocal(s: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function buildRange(
  fromParam: string | null,
  toParam: string | null,
): DateRangeValue | null {
  const f = parseYmdLocal(fromParam);
  const t = parseYmdLocal(toParam);
  if (!f || !t) return null;
  const from = new Date(f);
  from.setHours(0, 0, 0, 0);
  const to = new Date(t);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

// Suspense wrapper required by Next.js prerender for any client page
// that reads useSearchParams() directly.
export default function PrintOrdersPage() {
  return (
    <Suspense
      fallback={
        <main style={page}>
          <p>Loading orders…</p>
        </main>
      }
    >
      <PrintOrdersPageInner />
    </Suspense>
  );
}

function PrintOrdersPageInner() {
  const params = useSearchParams();
  const status = (params.get("status") ?? "all") as OrderFilterValue;
  const q = params.get("q") ?? "";
  const fromParam = params.get("from");
  const toParam = params.get("to");
  const range = useMemo(
    () => buildRange(fromParam, toParam),
    [fromParam, toParam],
  );
  const rangeLabel = range
    ? `Range: ${formatDate(fromParam)} → ${formatDate(toParam)}`
    : "Range: all dates";

  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
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
    const search = q.trim().toLowerCase();
    return orders.filter((o) => {
      // Date-range filter — matches the /admin/orders table which
      // filters on created_at with withinDateRange. When from/to are
      // missing, range is null and this passes everything (back-compat
      // for older bookmarks / entry points).
      if (!withinDateRange(o.created_at, range)) return false;
      if (status !== "all") {
        if (status === "expired") {
          // Match the /admin/orders page filter — 'expired' is computed,
          // not a stored status. See src/lib/order-state.ts.
          if (o.computed_state !== "expired") return false;
        } else if ((o.status ?? "").toLowerCase() !== status) {
          return false;
        }
      }
      if (!search) return true;
      const name = (o.customers?.full_name ?? "").toLowerCase();
      const phone = (o.customers?.phone ?? "").toLowerCase();
      return name.includes(search) || phone.includes(search);
    });
  }, [orders, status, q, range]);

  // Group: delivery_date → delivery_slot → orders[]. Null date/slot
  // bucket sorts last so the dated rows print first.
  const grouped = useMemo(() => {
    const dateMap = new Map<string, Map<string, AdminOrderRow[]>>();
    for (const o of filtered) {
      const dateKey = o.delivery_date ?? "__no_date__";
      const slotKey = o.delivery_slot ?? "__no_slot__";
      let slotMap = dateMap.get(dateKey);
      if (!slotMap) {
        slotMap = new Map();
        dateMap.set(dateKey, slotMap);
      }
      const list = slotMap.get(slotKey) ?? [];
      list.push(o);
      slotMap.set(slotKey, list);
    }
    const sortKey = (k: string) => (k === "__no_date__" ? "\uFFFF" : k);
    return Array.from(dateMap.entries())
      .sort(([a], [b]) => sortKey(a).localeCompare(sortKey(b)))
      .map(([date, slotMap]) => ({
        date,
        slots: Array.from(slotMap.entries())
          .sort(([a], [b]) => sortKey(a).localeCompare(sortKey(b)))
          .map(([slot, rows]) => ({ slot, rows })),
      }));
  }, [filtered]);

  // Trigger print once we've got data. A single setTimeout gives
  // the browser a paint to render the rows before the dialog opens.
  useEffect(() => {
    if (!loading && filtered.length > 0) {
      const t = setTimeout(() => window.print(), 250);
      return () => clearTimeout(t);
    }
  }, [loading, filtered.length]);

  if (loading) {
    return (
      <main style={page}>
        <p>Loading orders…</p>
      </main>
    );
  }
  if (error) {
    return (
      <main style={page}>
        <p style={{ color: "#EF4444" }}>Could not load orders: {error}</p>
      </main>
    );
  }
  // Empty-range / no-match → render a valid, printable header + message
  // instead of crashing. The auto-print effect above short-circuits on
  // filtered.length === 0, so the admin can hit "Print again" manually
  // if they still want a blank sheet.
  if (filtered.length === 0) {
    return (
      <main style={page}>
        <header style={{ marginBottom: "1.5rem" }}>
          <h1 style={{ fontSize: "1.4rem", margin: 0, letterSpacing: "0.1em" }}>
            Cadieux — Orders
          </h1>
          <p style={{ margin: "0.3rem 0 0", color: "rgba(29,29,31,0.7)", fontSize: "1rem" }}>
            {rangeLabel} · Status: {status} · Search: {q || "—"} · Generated{" "}
            {new Date().toLocaleString("en-IN")}
          </p>
        </header>
        <p>No orders in the selected range.</p>
      </main>
    );
  }

  return (
    <main style={page}>
      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.4rem", margin: 0, letterSpacing: "0.1em" }}>
          Cadieux — Orders
        </h1>
        <p style={{ margin: "0.3rem 0 0", color: "rgba(29,29,31,0.7)", fontSize: "1rem" }}>
          {rangeLabel} · Status: {status} · Search: {q || "—"} · Generated{" "}
          {new Date().toLocaleString("en-IN")}
        </p>
        <p style={{ margin: "0.3rem 0 0", fontSize: "1rem" }}>
          {filtered.length} order{filtered.length === 1 ? "" : "s"}
        </p>
      </header>
      {grouped.map((group) => (
        <section key={group.date} style={{ marginBottom: "1.4rem" }}>
          <h2 style={groupHeading}>
            {group.date === "__no_date__"
              ? "Undated"
              : formatDate(group.date)}
          </h2>
          {group.slots.map(({ slot, rows }) => (
            <div key={slot} style={{ marginBottom: "0.8rem" }}>
              <h3 style={slotHeading}>
                Slot: {slot === "__no_slot__" ? "Unscheduled" : slot}{" "}
                <span style={{ fontWeight: 400, color: "rgba(29,29,31,0.7)" }}>
                  · {rows.length} order{rows.length === 1 ? "" : "s"}
                </span>
              </h3>
              <table style={printTable}>
                <thead>
                  <tr>
                    <th style={printTh}>#</th>
                    <th style={printTh}>Customer</th>
                    <th style={printTh}>Phone</th>
                    <th style={printTh}>Address</th>
                    <th style={printTh}>Items</th>
                    <th style={printTh}>Total</th>
                    <th style={printTh}>Status</th>
                    <th style={printTh}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o, i) => (
                    <tr key={o.id}>
                      <td style={printTd}>{i + 1}</td>
                      <td style={printTd}>
                        {o.customers?.full_name ?? "—"}
                      </td>
                      <td style={printTd}>{o.customers?.phone ?? "—"}</td>
                      <td style={printTd}>{o.delivery_address ?? "—"}</td>
                      <td style={printTd}>{formatItems(o.items)}</td>
                      <td style={printTd}>{formatINR(o.total_amount)}</td>
                      <td style={printTd}>{o.status ?? "—"}</td>
                      <td style={printTd}>{formatDateTime(o.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      ))}
      <div className="no-print" style={{ marginTop: "1.5rem" }}>
        <button type="button" onClick={() => window.print()}>
          Print again
        </button>
      </div>
      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }
        }
      `}</style>
    </main>
  );
}

const page: React.CSSProperties = {
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  color: "#1D1D1F",
  background: "#FBF3D4",
  padding: "1.5rem",
};

const printTable: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const printTh: React.CSSProperties = {
  border: "1px solid rgba(29,29,31,0.25)",
  padding: "6px 8px",
  textAlign: "left",
  fontSize: "1rem",
  background: "rgba(29,29,31,0.08)",
};

const printTd: React.CSSProperties = {
  border: "1px solid rgba(29,29,31,0.25)",
  padding: "6px 8px",
  fontSize: "1rem",
  verticalAlign: "top",
};

const groupHeading: React.CSSProperties = {
  fontSize: "1rem",
  margin: "0 0 0.4rem",
  letterSpacing: "0.05em",
  borderBottom: "2px solid #1D1D1F",
  paddingBottom: "0.2rem",
};

const slotHeading: React.CSSProperties = {
  fontSize: "1rem",
  margin: "0.6rem 0 0.3rem",
  letterSpacing: "0.04em",
  color: "#1D1D1F",
};

function formatItems(items: AdminOrderItemSnapshot[] | null): string {
  if (!items || items.length === 0) return "—";
  return items
    .map((i) => {
      const qty = i.qty ?? i.quantity ?? 1;
      return `${qty}× ${i.name}`;
    })
    .join(", ");
}
