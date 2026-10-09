"use client";

// The RUN SHEET, printable. Seven columns, flat, no grouping:
//
//   Order ID · Name · Number · Address · Total · Payment status · Date
//
// WHY THIS IS A SEPARATE ROUTE FROM /admin/orders/print. That one is the
// KITCHEN's document: zone → date → slot sections, items, loaf subtotals
// and the notes strip, so a packer can work a route slot in one pass. This
// one is the DELIVERY PARTNER's document: one row per stop, the fields they
// read at a door, nothing else. Folding both into one page behind a mode
// flag would mean every future change to either layout has to be checked
// against the other audience.
//
// IT READS THE SAME PARAMS AND RUNS THE SAME PREDICATE. Every filter group
// (status, call, zone, pay, repeat), the search box, the day AND the basis
// come off the query string and go through @/lib/order-filter and
// @/lib/day-filter — the identical modules /admin/orders uses. That is the
// only reason the printed set can be trusted to equal the set on screen.
// The basis in particular MUST be carried: the board defaults to
// delivery_date and the 12h booking lead means placed-today and
// delivering-today barely intersect, so a sheet cut on the wrong column is
// a different list, not a near miss. It is printed in the header.
//
// No delivery fee, no serviceability, no distance — see order-run-sheet.ts.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatDate } from "@/lib/admin-formatting";
import type { AdminOrderRow } from "@/lib/admin-shared";
import {
  matchesDay,
  orderDateForBasis,
  parseBasis,
  parseDayParam,
  type DateBasis,
} from "@/lib/day-filter";
import {
  EMPTY_RULE_SET,
  ZONE_LABELS,
  resolveZoneWithSource,
  type ZoneKey,
  type ZoneRuleSet,
} from "@/lib/delivery-zones";
import { decodeStatusParam } from "@/lib/filter-menu";
import {
  decodePayParam,
  decodeZoneParam,
  matchesOrderFilter,
} from "@/lib/order-filter";
import { runSheetFields } from "@/lib/order-run-sheet";
import { PAYMENT_VIEW_LABELS } from "@/lib/payment-label";
import { buildRuleSet } from "@/lib/zone-rules";
import { fetchAllRules } from "@/lib/zone-rules-client";

// Suspense wrapper required by Next.js prerender for any client page that
// reads useSearchParams() directly.
export default function RunSheetPage() {
  return (
    <Suspense
      fallback={
        <main style={page}>
          <p>Loading orders…</p>
        </main>
      }
    >
      <RunSheetPageInner />
    </Suspense>
  );
}

function RunSheetPageInner() {
  const params = useSearchParams();

  // --- the five filter groups, decoded exactly as the board encodes them.
  // `status` is comma-separated (fixed enum keys, none contains a comma);
  // `call` is REPEATED because note bodies are operator-typed free text.
  const statusRaw = params.get("status");
  const callRaw = params.getAll("call").join("\u0000");
  const statuses = useMemo(() => decodeStatusParam(statusRaw), [statusRaw]);
  const calls = useMemo(
    () => (callRaw ? callRaw.split("\u0000") : []),
    [callRaw],
  );
  const repeatOnly = params.get("repeat") === "1";
  const zoneRaw = params.get("zone");
  const zones = useMemo(() => decodeZoneParam(zoneRaw), [zoneRaw]);
  const payRaw = params.get("pay");
  const payments = useMemo(() => decodePayParam(payRaw), [payRaw]);
  const q = params.get("q") ?? "";
  const day = parseDayParam(params.get("date"));
  const basis: DateBasis = parseBasis(params.get("basis"));

  // The header states the slice in the ADMIN's vocabulary — the same words
  // the dropdown shows, including the payment bucket. A sheet whose
  // Payment column reads COD while it was cut by "Awaiting" is correct (see
  // the contract in payment-label.ts) and this line is what makes that
  // legible instead of looking like a fault.
  const filterLabel =
    [
      ...statuses,
      ...calls,
      ...zones.map((z) => ZONE_LABELS[z]),
      ...payments.map((p) => PAYMENT_VIEW_LABELS[p]),
      ...(repeatOnly ? ["repeat customers"] : []),
    ].join(", ") || "all";
  const basisLabel = basis === "delivery" ? "by delivery date" : "by order date";
  const dayLabel = day
    ? `${formatDate(day)} (${basisLabel})`
    : `all dates (${basisLabel})`;

  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // ?all=1 — the run sheet is cut from the whole table client-side off
      // the URL params, so the board's bounded default window would silently
      // drop stops from the sheet.
      const res = await adminFetch<{ orders: AdminOrderRow[] }>(
        "/api/admin/orders?all=1",
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

  // Learned zone rules — the same fetch the board makes, so a rule that
  // moves a row between zones on screen moves it here too.
  const [zoneRules, setZoneRules] = useState<ZoneRuleSet>(EMPTY_RULE_SET);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchAllRules();
        if (cancelled) return;
        setZoneRules(buildRuleSet(res.rules, res.overrides));
      } catch {
        /* fall back to the built-in map */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Zone is DERIVED, never stored. Resolved once per row before the
  // predicate runs, because matchesOrderFilter fails closed on a row whose
  // zone was never resolved.
  const zoneOf = useMemo(() => {
    const m = new Map<string, ZoneKey>();
    for (const o of orders) {
      m.set(
        o.id,
        resolveZoneWithSource(
          {
            address: o.delivery_address,
            isPickup: o.fulfillment_type === "pickup",
            orderId: o.id,
          },
          zoneRules,
        ).zone,
      );
    }
    return m;
  }, [orders, zoneRules]);

  const filtered = useMemo(() => {
    const search = q.trim().toLowerCase();
    return orders.filter((o) => {
      if (!matchesDay(orderDateForBasis(o, basis), day)) return false;
      const withZone = { ...o, zone: zoneOf.get(o.id) };
      if (
        !matchesOrderFilter(
          withZone,
          statuses,
          calls,
          repeatOnly,
          zones,
          payments,
        )
      )
        return false;
      if (!search) return true;
      const name = (o.customers?.full_name ?? "").toLowerCase();
      const phone = (o.customers?.phone ?? "").toLowerCase();
      return name.includes(search) || phone.includes(search);
    });
    // `basis` must stay in this list: a link that changes only ?basis
    // re-renders without remounting, and a stale memo would serve rows cut
    // on the previous column under a header already naming the new one.
  }, [orders, statuses, calls, repeatOnly, zones, payments, q, day, basis, zoneOf]);

  const rows = useMemo(
    () => filtered.map((o) => ({ id: o.id, f: runSheetFields(o, basis) })),
    [filtered, basis],
  );

  // One paint before the dialog, so the rows are on the page when it opens.
  useEffect(() => {
    if (!loading && rows.length > 0) {
      const t = setTimeout(() => window.print(), 250);
      return () => clearTimeout(t);
    }
  }, [loading, rows.length]);

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

  return (
    <main style={page}>
      <header style={{ marginBottom: "1.2rem" }}>
        <h1 style={{ fontSize: "1.4rem", margin: 0, letterSpacing: "0.1em" }}>
          Cadieux — Run sheet
        </h1>
        <p style={subLine}>
          {dayLabel} · Filter: {filterLabel} · Search: {q || "—"}
        </p>
        <p style={subLine}>
          {rows.length} order{rows.length === 1 ? "" : "s"} · Generated{" "}
          {new Date().toLocaleString("en-IN")}
        </p>
      </header>

      {/* An empty slice still prints a valid, dated header — a blank sheet
          that says which day and filter produced nothing is evidence; a
          crash or a bare page is not. The auto-print effect above skips
          the dialog, so "Print again" is the way to get one on paper. */}
      {rows.length === 0 ? (
        <p>No orders match this filter.</p>
      ) : (
        <table style={printTable}>
          <thead>
            <tr>
              {/* This order is the specification. Do not reorder. */}
              <th style={printTh}>Order ID</th>
              <th style={printTh}>Name</th>
              <th style={printTh}>Number</th>
              <th style={printTh}>Address</th>
              <th style={printTh}>Total</th>
              <th style={printTh}>Payment status</th>
              <th style={printTh}>Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, f }) => (
              <tr key={id}>
                <td style={{ ...printTd, ...orderIdCell }}>{f.orderId}</td>
                <td style={printTd}>{f.name}</td>
                <td style={{ ...printTd, whiteSpace: "nowrap" }}>{f.phone}</td>
                <td style={printTd}>{f.address}</td>
                <td style={{ ...printTd, whiteSpace: "nowrap" }}>{f.total}</td>
                <td style={{ ...printTd, whiteSpace: "nowrap" }}>{f.payment}</td>
                <td style={{ ...printTd, whiteSpace: "nowrap" }}>{f.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

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
          /* A stop must not be torn in half by a page break. */
          tr {
            page-break-inside: avoid;
          }
          thead {
            display: table-header-group;
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

const subLine: React.CSSProperties = {
  margin: "0.3rem 0 0",
  color: "rgba(29,29,31,0.7)",
  fontSize: "1rem",
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

const orderIdCell: React.CSSProperties = {
  fontWeight: 700,
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  whiteSpace: "nowrap",
};
