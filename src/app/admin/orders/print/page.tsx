"use client";

// Print-friendly orders sheet. Renders the same filter set as
// /admin/orders (status, call, q, sort, date — all carried in query
// params) and triggers window.print() once loaded.
//
// The day comes from the DayFilter on the orders page: ?date=YYYY-MM-DD,
// one IST calendar day, applied to the column named by ?basis
// (delivery|order) via @/lib/day-filter — the SAME module the screen
// uses, so the sheet and the table cannot disagree. The basis MUST be
// carried: the orders page defaults to filtering on delivery_date, and
// the 12h booking lead means placed-today and delivering-today barely
// intersect — printing a sheet filtered on created_at from a screen
// filtered on delivery_date hands the kitchen a different set of orders
// than the one it was printed from. The basis is stated in the header so
// it is never ambiguous which axis a sheet on the bench was cut on.
//
// Rows are grouped first by delivery_date then by delivery_slot so the
// kitchen can pack each route slot in one pass. Orders missing either
// field (web checkout flow, legacy rows) fall into the "Undated" /
// "No slot" buckets at the end.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatDate, formatDateTime, formatINR } from "@/lib/admin-formatting";
import { paymentLabel } from "@/lib/payment-label";
import { formatSlotForDisplay } from "@/lib/delivery-slots";
import { AdminOrderItemSnapshot, AdminOrderRow } from "@/lib/admin-shared";
import { matchesOrderFilter } from "@/lib/order-filter";
import { decodeStatusParam } from "@/lib/filter-menu";
import {
  matchesDay,
  orderDateForBasis,
  parseBasis,
  parseDayParam,
  type DateBasis,
} from "@/lib/day-filter";

// The private parseYmdLocal + buildRange that used to sit here are GONE.
// They built a local-midnight..local-23:59 window out of ?from/?to, which
// is both a range this board no longer has and a comparison in the
// browser's timezone rather than IST. The day is now matched as a string
// by @/lib/day-filter, the one module the screen also uses.

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
  // Both filter groups come from the orders page. `status` is
  // comma-separated (a lone value still means what it always did);
  // `call` is REPEATED because note bodies can contain commas. See
  // src/lib/order-filter.ts — the predicate lives there so this view and
  // the table it was printed from can never disagree again.
  const statusRaw = params.get("status");
  const callRaw = params.getAll("call").join("\u0000");
  const statuses = useMemo(() => decodeStatusParam(statusRaw), [statusRaw]);
  const calls = useMemo(
    () => (callRaw ? callRaw.split("\u0000") : []),
    [callRaw],
  );
  // Third filter group, carried as ?repeat=1. Without it the packing list
  // would silently ignore "Repeat customers only" and print rows the
  // screen it was printed from was hiding.
  const repeatOnly = params.get("repeat") === "1";
  const filterLabel =
    [...statuses, ...calls, ...(repeatOnly ? ["repeat customers"] : [])].join(
      ", ",
    ) || "all";
  const q = params.get("q") ?? "";
  // ONE day, ?date=YYYY-MM-DD, narrowed by the same parser the screen
  // uses. Absent or malformed → null → every row, which is exactly what
  // the screen shows in that state.
  const day = parseDayParam(params.get("date"));
  // Default MUST match DEFAULT_BASIS on /admin/orders, so an older
  // bookmark that predates the param still prints what today's screen
  // would show.
  const basis: DateBasis = parseBasis(params.get("basis"));
  const basisLabel = basis === "delivery" ? "by delivery date" : "by order date";
  const dayLabel = day
    ? `Date: ${formatDate(day)} (${basisLabel})`
    : "Date: all dates";

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
      // Day filter on the same column the table used, through the same
      // module. When ?date is missing, day is null and this passes
      // everything (back-compat for older bookmarks / entry points).
      if (!matchesDay(orderDateForBasis(o, basis), day)) return false;
      if (!matchesOrderFilter(o, statuses, calls, repeatOnly)) return false;
      if (!search) return true;
      const name = (o.customers?.full_name ?? "").toLowerCase();
      const phone = (o.customers?.phone ?? "").toLowerCase();
      return name.includes(search) || phone.includes(search);
    });
    // `basis` MUST be in this list. It is read from useSearchParams(), so
    // a link that changes only ?basis re-renders this component WITHOUT
    // remounting it; omitting it here left the memo serving rows cut on
    // the previous column while the header above already said the new one.
  }, [orders, statuses, calls, repeatOnly, q, day, basis]);

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
            {dayLabel} · Status: {filterLabel} · Search: {q || "—"} · Generated{" "}
            {new Date().toLocaleString("en-IN")}
          </p>
        </header>
        <p>No orders on the selected date.</p>
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
          {dayLabel} · Status: {filterLabel} · Search: {q || "—"} · Generated{" "}
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
                {/* Grouping and sorting above stay on the raw key; only
                    the printed label is humanised, so the packing sheet
                    reads the same as the screen. */}
                Slot:{" "}
                {slot === "__no_slot__"
                  ? "Unscheduled"
                  : formatSlotForDisplay(slot)}{" "}
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
                    {/* Whoever carries this sheet needs to know which
                        doors take money. It said nothing about payment
                        before, so the sheet and the rider's WhatsApp
                        message disagreed about the same run. */}
                    <th style={printTh}>Payment</th>
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
                      <td style={printTd}>
                        {paymentLabel({
                          payment_status: o.payment_status,
                          amountDue:
                            typeof o.total_amount === "number"
                              ? o.total_amount
                              : null,
                        })}
                      </td>
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
