"use client";

// Customer lookup. Fetches /api/admin/customers with optional search
// (server-side ILIKE on full_name + phone). Renders a table with
// per-customer aggregates and a click-through to /admin/customers/[id].

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import {
  formatDate,
  formatINR,
  telHref,
  whatsAppHref,
} from "@/lib/admin-formatting";
import { AdminCustomerSummary } from "@/lib/admin-shared";

type CustomerListRow = AdminCustomerSummary & {
  created_at: string;
  total_orders: number;
  total_spent: number;
  last_order_at: string | null;
};

export default function CustomersPage() {
  const [rows, setRows] = useState<CustomerListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async (q: string) => {
    setError(null);
    setLoading(true);
    try {
      const url =
        q.trim().length > 0
          ? `/api/admin/customers?q=${encodeURIComponent(q.trim())}`
          : "/api/admin/customers";
      const res = await adminFetch<{ customers: CustomerListRow[] }>(url);
      setRows(res.customers ?? []);
    } catch (e) {
      if (e instanceof AdminFetchError) setError(e.message);
      else setError("Could not load customers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  // Debounced reload on query change — 300ms so we don't slam the
  // server on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => void load(query), 300);
    return () => clearTimeout(t);
  }, [query, load]);

  return (
    <AdminShell title="Customers" subtitle="Lookup &amp; activity">
      <div className="flex flex-wrap gap-3 mb-6 items-center">
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
            minWidth: 280,
          }}
        />
        <span style={{ color: "rgba(192,200,206,0.55)", fontSize: "0.75rem" }}>
          {rows.length} result{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      {error ? (
        <div
          style={{
            border: "1px solid rgba(239,68,68,0.45)",
            padding: "0.8rem 1rem",
            color: "#fca5a5",
            marginBottom: "1rem",
            fontSize: "0.85rem",
            fontFamily: "var(--font-body)",
          }}
        >
          {error}
        </div>
      ) : null}
      {loading ? (
        <Placeholder>Loading customers…</Placeholder>
      ) : rows.length === 0 ? (
        <Placeholder>No customers found.</Placeholder>
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
                <th style={th}>Name</th>
                <th style={th}>Phone</th>
                <th style={th}>City</th>
                <th style={th}>Orders</th>
                <th style={th}>Spent</th>
                <th style={th}>Last order</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr
                  key={c.id}
                  style={{
                    background:
                      i % 2 === 0
                        ? "rgba(245,158,11,0.025)"
                        : "transparent",
                  }}
                >
                  <td style={td}>
                    <Link
                      href={`/admin/customers/${c.id}`}
                      style={{ color: "#fbf3d4", textDecoration: "none" }}
                    >
                      {c.full_name ?? "—"}
                    </Link>
                  </td>
                  <td style={td}>
                    <div className="flex flex-wrap gap-2 items-center">
                      {c.phone ? (
                        <>
                          <a
                            href={telHref(c.phone)}
                            style={{
                              color: "rgba(245,158,11,0.85)",
                              fontSize: "0.78rem",
                            }}
                          >
                            {c.phone}
                          </a>
                          <a
                            href={whatsAppHref(c.phone)}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: "0.55rem",
                              letterSpacing: "0.2em",
                              textTransform: "uppercase",
                              color: "#4ade80",
                              border: "1px solid rgba(74,222,128,0.5)",
                              padding: "1px 6px",
                              textDecoration: "none",
                            }}
                          >
                            WA
                          </a>
                        </>
                      ) : (
                        "—"
                      )}
                    </div>
                  </td>
                  <td style={td}>{c.city ?? "—"}</td>
                  <td style={td}>{c.total_orders}</td>
                  <td style={td}>{formatINR(c.total_spent)}</td>
                  <td style={td}>{formatDate(c.last_order_at)}</td>
                  <td style={td}>
                    <Link
                      href={`/admin/customers/${c.id}`}
                      style={buttonSmAnchor}
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
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
      }}
    >
      {children}
    </div>
  );
}

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
  color: "#fbf3d4",
  fontSize: "0.85rem",
  verticalAlign: "top",
  borderBottom: "1px solid rgba(245,158,11,0.06)",
};

const buttonSmAnchor: React.CSSProperties = {
  padding: "0.3rem 0.7rem",
  background: "transparent",
  border: "1px solid rgba(245,158,11,0.45)",
  color: "#f59e0b",
  fontFamily: "var(--font-body)",
  fontSize: "0.62rem",
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  textDecoration: "none",
  display: "inline-block",
};
