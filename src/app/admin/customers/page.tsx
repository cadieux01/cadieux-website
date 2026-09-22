"use client";

// Customer lookup. Fetches /api/admin/customers with optional search
// (server-side ILIKE on full_name + phone). Renders a table with
// per-customer aggregates and a click-through to /admin/customers/[id].

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import {
  DateRangeDropdown,
  parsePresetKey,
  resolveCustomRange,
  resolvePreset,
  withinDateRange,
  type DateRangeMeta,
  type DateRangeValue,
  type PresetKey,
} from "@/components/admin/DateRangeDropdown";
import {
  stashScrollY,
  useScrollRestore,
  useUrlWriteback,
} from "@/lib/admin-url-state";
import { ContactActions } from "@/components/admin/ContactActions";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { csvFilename, downloadCsv, toCsv } from "@/lib/admin-csv";
import {
  formatDate,
  formatINR,
} from "@/lib/admin-formatting";
import { AdminCustomerSummary } from "@/lib/admin-shared";

type CustomerListRow = AdminCustomerSummary & {
  created_at: string;
  total_orders: number;
  total_spent: number;
  last_order_at: string | null;
};

// Suspense wrapper is required because the inner component reads
// useSearchParams() to hydrate its filters; Next.js prerender fails the
// build for any client page that consumes it without a suspense
// boundary. (This comment used to name a `useDateRangeFromQuery` hook
// that exists nowhere in src — the boundary was right, the reason was
// stale.)
export default function CustomersPage() {
  return (
    <Suspense fallback={<AdminLoading />}>
      <CustomersPageInner />
    </Suspense>
  );
}

function AdminLoading() {
  return (
    <div
      style={{
        padding: "2rem",
        color: "rgba(251,243,212,0.7)",
        fontFamily: "var(--font-body)",
        fontSize: "1rem",
        letterSpacing: "0.05em",
      }}
    >
      Loading…
    </div>
  );
}

// Own bucket per board — coming back from a customer must not inherit
// where the operator was on the orders list.
const SCROLL_KEY = "admin:customers:scrollY";

function CustomersPageInner() {
  const [rows, setRows] = useState<CustomerListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search box and date range hydrate from the query string on first render
  // and mirror back to it on change, so opening a customer and pressing
  // Back returns the operator to the same slice instead of an unfiltered
  // list they have to re-narrow. Same mechanism as /admin/orders and
  // /admin/subscriptions — @/lib/admin-url-state, not a second copy of it.
  //
  // Read ONCE, in lazy initialisers: useSearchParams() subscribes, and
  // re-deriving state from it on every render would fight the writeback
  // below for control of the same values.
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  // The picker's own label, kept alongside the resolved dates: a bare
  // { from, to } cannot say whether the operator picked "This Week" or
  // typed those two dates, and the dropdown would reopen on the default.
  const [preset, setPreset] = useState<PresetKey>(
    () => parsePresetKey(searchParams.get("preset")) ?? "this_month",
  );
  const [customFrom] = useState(() => searchParams.get("from") ?? "");
  const [customTo] = useState(() => searchParams.get("to") ?? "");
  const [range, setRange] = useState<DateRangeValue | null>(() => {
    const p = parsePresetKey(searchParams.get("preset")) ?? "this_month";
    if (p !== "custom") return resolvePreset(p);
    // A `custom` preset with unparseable dates is a broken link, not an
    // instruction to show everything — fall back to the default rather
    // than silently widening the range to all time.
    return (
      resolveCustomRange(
        searchParams.get("from") ?? "",
        searchParams.get("to") ?? "",
      ) ?? resolvePreset("this_month")
    );
  });
  // Whatever the picker last emitted, so the writeback can reproduce it.
  const [rangeMeta, setRangeMeta] = useState<DateRangeMeta>(() => ({
    preset: parsePresetKey(searchParams.get("preset")) ?? "this_month",
    customFrom: searchParams.get("from") ?? "",
    customTo: searchParams.get("to") ?? "",
  }));

  const handleRangeChange = useCallback(
    (next: DateRangeValue, meta?: DateRangeMeta) => {
      setRange(next);
      if (meta) {
        setRangeMeta(meta);
        setPreset(meta.preset);
      }
    },
    [],
  );

  // Defaults are OMITTED, not encoded, so a plain /admin/customers link
  // stays clean and the parsers above stay the single definition of what
  // "unset" means.
  const qs = useMemo(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query);
    if (rangeMeta.preset !== "this_month")
      params.set("preset", rangeMeta.preset);
    if (rangeMeta.customFrom) params.set("from", rangeMeta.customFrom);
    if (rangeMeta.customTo) params.set("to", rangeMeta.customTo);
    return params.toString();
  }, [query, rangeMeta]);
  useUrlWriteback("/admin/customers", qs);
  useScrollRestore(SCROLL_KEY, !loading);

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
      else if (e instanceof Error) setError(e.message);
      else setError("Could not load customers.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(query);
    } finally {
      setRefreshing(false);
    }
  }, [load, query]);

  // Debounced reload on query change — 300ms so we don't slam the
  // server on every keystroke. This also performs the FIRST load; there
  // used to be a separate mount effect calling load(""), which was
  // harmless while `query` always started empty but is a race now that it
  // hydrates from the URL — the unfiltered response could land second and
  // overwrite the filtered one.
  useEffect(() => {
    const t = setTimeout(() => void load(query), 300);
    return () => clearTimeout(t);
  }, [query, load]);

  // Range filter is applied client-side on customer.created_at; the
  // server doesn't accept a date filter today and adding one is
  // overkill given the customer table is small.
  const visible = useMemo(
    () => rows.filter((c) => withinDateRange(c.created_at, range)),
    [rows, range],
  );

  const handleExport = () => {
    const csv = toCsv(visible, [
      { header: "Customer ID", value: (c) => c.id },
      { header: "Name", value: (c) => c.full_name ?? "" },
      { header: "Phone", value: (c) => c.phone ?? "" },
      { header: "City", value: (c) => c.city ?? "" },
      { header: "Total orders", value: (c) => c.total_orders },
      { header: "Total spent", value: (c) => c.total_spent },
      { header: "Last order", value: (c) => c.last_order_at ?? "" },
      { header: "Joined", value: (c) => c.created_at },
    ]);
    downloadCsv(csvFilename("customers"), csv);
  };

  return (
    <AdminShell
      title="Customers"
      subtitle="Lookup &amp; activity"
      actions={
        <>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            style={{
              ...chipNeutral,
              cursor: refreshing ? "wait" : "pointer",
              opacity: refreshing ? 0.6 : 1,
            }}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={visible.length === 0}
            style={chipNeutral}
          >
            Export CSV
          </button>
        </>
      }
    >
      <div className="mb-4">
        <DateRangeDropdown
          onChange={handleRangeChange}
          initialPreset={preset}
          initialCustomFrom={customFrom}
          initialCustomTo={customTo}
        />
      </div>
      <div className="flex flex-wrap gap-3 mb-6 items-center">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or phone"
          className="px-3 py-2 bg-transparent outline-none"
          style={{
            border: "1px solid rgba(251,243,212,0.3)",
            color: "#FBF3D4",
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
            letterSpacing: "0.05em",
            minWidth: 280,
          }}
        />
        <span style={{ color: "rgba(251,243,212,0.55)", fontSize: "1rem" }}>
          {visible.length} result{visible.length === 1 ? "" : "s"}
        </span>
      </div>

      {error ? (
        <div
          style={{
            border: "1px solid rgba(239,68,68,0.45)",
            padding: "0.8rem 1rem",
            color: "#EF4444",
            marginBottom: "1rem",
            fontSize: "1rem",
            fontFamily: "var(--font-body)",
          }}
        >
          {error}
        </div>
      ) : null}
      {loading ? (
        <Placeholder>Loading customers…</Placeholder>
      ) : visible.length === 0 ? (
        <Placeholder>No customers match the filters.</Placeholder>
      ) : (
        <div
          style={{
            border: "1px solid rgba(251,243,212,0.18)",
            borderRadius: 6,
            overflow: "hidden",
          }}
        >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
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
              {visible.map((c, i) => (
                <tr
                  key={c.id}
                  style={{
                    background:
                      i % 2 === 0
                        ? "rgba(251,243,212,0.025)"
                        : "transparent",
                  }}
                >
                  <td style={td}>
                    <Link
                      href={`/admin/customers/${c.id}`}
                      // Stash on click, not on unmount: the offset has to be
                      // read while the list is still the scrolled document.
                      // The entry is one-shot — useScrollRestore clears it.
                      onClick={() => stashScrollY(SCROLL_KEY)}
                      style={{ color: "#FBF3D4", textDecoration: "none" }}
                    >
                      {c.full_name ?? "—"}
                    </Link>
                  </td>
                  <td style={td}>
                    {c.phone ? (
                      <div className="flex flex-wrap gap-2 items-center">
                        <span
                          style={{
                            color: "rgba(251,243,212,0.85)",
                            fontSize: "1rem",
                          }}
                        >
                          {c.phone}
                        </span>
                        <ContactActions
                          phone={c.phone}
                          customerName={c.full_name}
                        />
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={td}>{c.city ?? "—"}</td>
                  <td style={td}>{c.total_orders}</td>
                  <td style={td}>{formatINR(c.total_spent)}</td>
                  <td style={td}>{formatDate(c.last_order_at)}</td>
                  <td style={td}>
                    <Link
                      href={`/admin/customers/${c.id}`}
                      onClick={() => stashScrollY(SCROLL_KEY)}
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
        </div>
      )}
    </AdminShell>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px dashed rgba(251,243,212,0.2)",
        padding: "3rem 1rem",
        textAlign: "center",
        color: "rgba(251,243,212,0.55)",
        fontFamily: "var(--font-body)",
        fontSize: "1rem",
      }}
    >
      {children}
    </div>
  );
}

const tableHeadRow: React.CSSProperties = {
  background: "rgba(251,243,212,0.08)",
  color: "rgba(251,243,212,0.9)",
  textTransform: "uppercase",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "0.7rem 1rem",
  fontFamily: "var(--font-body)",
  fontWeight: 400,
  borderBottom: "1px solid rgba(251,243,212,0.15)",
};

const td: React.CSSProperties = {
  padding: "0.7rem 1rem",
  fontFamily: "var(--font-body)",
  color: "#FBF3D4",
  fontSize: "1rem",
  verticalAlign: "top",
  borderBottom: "1px solid rgba(251,243,212,0.06)",
};

const chipNeutral: React.CSSProperties = {
  padding: "0.35rem 0.85rem",
  border: "1px solid rgba(251,243,212,0.4)",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
  background: "transparent",
  color: "rgba(251,243,212,0.85)",
  cursor: "pointer",
  textTransform: "uppercase",
};

const buttonSmAnchor: React.CSSProperties = {
  padding: "0.3rem 0.7rem",
  background: "transparent",
  border: "1px solid rgba(251,243,212,0.45)",
  color: "#FBF3D4",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  textDecoration: "none",
  display: "inline-block",
};
