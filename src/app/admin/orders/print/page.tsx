"use client";

// Print-friendly packing list. Renders the same filter set as
// /admin/orders (status, q, sort all carried in query params) and
// triggers window.print() once loaded.
//
// Future: group rows by delivery slot. Skipped for now because the
// orders table has no delivery_slot column.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatDateTime, formatINR } from "@/lib/admin-formatting";
import { AdminOrderRow, OrderFilterValue } from "@/lib/admin-shared";

export default function PrintPackingListPage() {
  const params = useSearchParams();
  const status = (params.get("status") ?? "all") as OrderFilterValue;
  const q = params.get("q") ?? "";

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
      if (status !== "all" && (o.status ?? "").toLowerCase() !== status) {
        return false;
      }
      if (!search) return true;
      const name = (o.customers?.full_name ?? "").toLowerCase();
      const phone = (o.customers?.phone ?? "").toLowerCase();
      return name.includes(search) || phone.includes(search);
    });
  }, [orders, status, q]);

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
        <p>Loading packing list…</p>
      </main>
    );
  }
  if (error) {
    return (
      <main style={page}>
        <p style={{ color: "#b91c1c" }}>Could not load orders: {error}</p>
      </main>
    );
  }
  if (filtered.length === 0) {
    return (
      <main style={page}>
        <p>No orders match the requested filters.</p>
      </main>
    );
  }

  return (
    <main style={page}>
      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.4rem", margin: 0, letterSpacing: "0.1em" }}>
          Cadieux — Packing List
        </h1>
        <p style={{ margin: "0.3rem 0 0", color: "#444", fontSize: "0.85rem" }}>
          Status: {status} · Search: {q || "—"} · Generated{" "}
          {new Date().toLocaleString("en-IN")}
        </p>
        <p style={{ margin: "0.3rem 0 0", fontSize: "0.85rem" }}>
          {filtered.length} order{filtered.length === 1 ? "" : "s"}
        </p>
      </header>
      <table style={printTable}>
        <thead>
          <tr>
            <th style={printTh}>#</th>
            <th style={printTh}>Customer</th>
            <th style={printTh}>Phone</th>
            <th style={printTh}>Address</th>
            <th style={printTh}>Total</th>
            <th style={printTh}>Status</th>
            <th style={printTh}>Created</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((o, i) => (
            <tr key={o.id}>
              <td style={printTd}>{i + 1}</td>
              <td style={printTd}>{o.customers?.full_name ?? "—"}</td>
              <td style={printTd}>{o.customers?.phone ?? "—"}</td>
              <td style={printTd}>{o.delivery_address ?? "—"}</td>
              <td style={printTd}>{formatINR(o.total_amount)}</td>
              <td style={printTd}>{o.status ?? "—"}</td>
              <td style={printTd}>{formatDateTime(o.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  color: "#000",
  background: "#fff",
  padding: "1.5rem",
};

const printTable: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const printTh: React.CSSProperties = {
  border: "1px solid #ccc",
  padding: "6px 8px",
  textAlign: "left",
  fontSize: "0.75rem",
  background: "#f3f3f3",
};

const printTd: React.CSSProperties = {
  border: "1px solid #ccc",
  padding: "6px 8px",
  fontSize: "0.8rem",
  verticalAlign: "top",
};
