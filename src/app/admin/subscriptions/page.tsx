"use client";

// Subscription health board. Calls the enriched
// /api/admin/subscriptions?enrich=1 endpoint so each row carries a
// server-computed derived_end_date and remaining_deliveries count.
//
// Pause/Resume/Cancel actions hit the existing PATCH
// /api/admin/subscriptions/[id] route. We don't build new transition
// logic here.

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import {
  DateRangePicker,
  useDateRangeFromQuery,
  withinRange,
} from "@/components/admin/DateRangePicker";
import { ContactActions } from "@/components/admin/ContactActions";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { csvFilename, downloadCsv, toCsv } from "@/lib/admin-csv";
import {
  addDaysISO,
  formatDate,
  formatINR,
  isoLocalDate,
} from "@/lib/admin-formatting";
import { AdminSubscriptionRow, SUBSCRIPTION_STATUSES } from "@/lib/admin-shared";

type FilterValue =
  | "all"
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "expiring_7d";

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "expiring_7d", label: "Expiring in 7 days" },
];

// Suspense wrapper required by Next.js prerender for any client page
// that reads useSearchParams() — useDateRangeFromQuery does.
export default function SubscriptionsPage() {
  return (
    <Suspense fallback={<AdminLoading />}>
      <SubscriptionsPageInner />
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

function SubscriptionsPageInner() {
  const [subs, setSubs] = useState<AdminSubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const range = useDateRangeFromQuery();

  const load = useCallback(async () => {
    setError(null);
    try {
      // For the "expiring in 7 days" filter we still want all rows so
      // we can compute the window client-side. Otherwise we pass the
      // status to the server.
      const statusParam =
        filter === "all" || filter === "expiring_7d"
          ? ""
          : `&status=${filter}`;
      const res = await adminFetch<{ subscriptions: AdminSubscriptionRow[] }>(
        `/api/admin/subscriptions?enrich=1${statusParam}`,
      );
      setSubs(res.subscriptions ?? []);
    } catch (e) {
      if (e instanceof AdminFetchError) setError(e.message);
      else setError("Could not load subscriptions.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const inRange = subs.filter((s) => withinRange(s.created_at, range));
    if (filter !== "expiring_7d") return inRange;
    const today = isoLocalDate(new Date());
    const horizon = addDaysISO(today, 7);
    return inRange.filter((s) => {
      if (s.status !== "active") return false;
      const end = s.derived_end_date;
      if (!end) return false;
      return end >= today && end <= horizon;
    });
  }, [subs, filter, range]);

  const setStatus = async (
    sub: AdminSubscriptionRow,
    nextStatus: "active" | "paused" | "cancelled",
  ) => {
    setBusyId(sub.id);
    const prev = subs;
    setSubs((curr) =>
      curr.map((s) => (s.id === sub.id ? { ...s, status: nextStatus } : s)),
    );
    try {
      await adminFetch(`/api/admin/subscriptions/${sub.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
    } catch (e) {
      setSubs(prev);
      if (e instanceof AdminFetchError) alert(e.message);
      else alert("Update failed.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminShell
      title="Subscription Health"
      subtitle="End-date derived from delivery schedule"
      actions={
        <>
          <button
            type="button"
            onClick={() => exportSubsCsv(filtered)}
            disabled={filtered.length === 0}
            style={chipNeutral}
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void load()}
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
      <div className="flex flex-wrap gap-2 mb-6">
        {FILTERS.map((f) => {
          const active = f.value === filter;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              style={{
                ...chipBase,
                color: active ? "#06120c" : "rgba(245,158,11,0.85)",
                background: active ? "#f59e0b" : "transparent",
                borderColor: active ? "#f59e0b" : "rgba(245,158,11,0.4)",
              }}
            >
              {f.label}
            </button>
          );
        })}
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
        <Placeholder>Loading subscriptions…</Placeholder>
      ) : filtered.length === 0 ? (
        <Placeholder>No subscriptions match the filter.</Placeholder>
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
                <th style={th}>Customer</th>
                <th style={th}>Plan</th>
                <th style={th}>Weeks</th>
                <th style={th}>Started</th>
                <th style={th}>Ends</th>
                <th style={th}>Remaining</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => {
                const busy = busyId === s.id;
                const canPause = s.status === "active";
                const canResume = s.status === "paused";
                const canCancel =
                  s.status !== "cancelled" && s.status !== "completed";
                return (
                  <tr
                    key={s.id}
                    style={{
                      background:
                        i % 2 === 0
                          ? "rgba(245,158,11,0.025)"
                          : "transparent",
                    }}
                  >
                    <td style={td}>
                      <Link
                        href={
                          s.customer_id
                            ? `/admin/customers/${s.customer_id}`
                            : "#"
                        }
                        style={{ color: "#fbf3d4", textDecoration: "none" }}
                      >
                        {s.customer?.full_name ?? "—"}
                      </Link>
                      {s.customer?.phone ? (
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span
                            style={{
                              color: "rgba(245,158,11,0.85)",
                              fontSize: "0.75rem",
                            }}
                          >
                            {s.customer.phone}
                          </span>
                          <ContactActions
                            phone={s.customer.phone}
                            customerName={s.customer.full_name}
                            orderInfo={`${s.product_name} subscription`}
                          />
                        </div>
                      ) : null}
                    </td>
                    <td style={td}>
                      <div>{s.product_name}</div>
                      <div
                        style={{
                          color: "rgba(192,200,206,0.55)",
                          fontSize: "0.72rem",
                        }}
                      >
                        {s.quantity_per_delivery}× · {s.frequency}
                      </div>
                    </td>
                    <td style={td}>{s.total_weeks}</td>
                    <td style={td}>{formatDate(s.created_at)}</td>
                    <td style={td}>
                      {s.derived_end_date
                        ? formatDate(s.derived_end_date)
                        : "—"}
                    </td>
                    <td style={td}>{s.remaining_deliveries ?? 0}</td>
                    <td style={td}><StatusBadge status={s.status} /></td>
                    <td style={td}>
                      <div className="flex flex-wrap gap-2">
                        {canPause ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void setStatus(s, "paused")}
                            style={{ ...buttonSm, opacity: busy ? 0.5 : 1 }}
                          >
                            Pause
                          </button>
                        ) : null}
                        {canResume ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void setStatus(s, "active")}
                            style={{ ...buttonSm, opacity: busy ? 0.5 : 1 }}
                          >
                            Resume
                          </button>
                        ) : null}
                        {canCancel ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (confirm("Cancel this subscription?")) {
                                void setStatus(s, "cancelled");
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

      <p
        style={{
          marginTop: "1.5rem",
          color: "rgba(192,200,206,0.5)",
          fontSize: "0.75rem",
          fontFamily: "var(--font-body)",
          maxWidth: 720,
          lineHeight: 1.6,
        }}
      >
        End date = MAX(delivery_date) across subscription_deliveries, with a
        fallback to created_at + weeks × 7d (matches the cron reminder rule).
        Allowed statuses: {SUBSCRIPTION_STATUSES.join(", ")}.
      </p>
    </AdminShell>
  );
}

function exportSubsCsv(rows: AdminSubscriptionRow[]): void {
  const csv = toCsv(rows, [
    { header: "Subscription ID", value: (s) => s.id },
    { header: "Customer", value: (s) => s.customer?.full_name ?? "" },
    { header: "Phone", value: (s) => s.customer?.phone ?? "" },
    { header: "Product", value: (s) => s.product_name },
    { header: "Quantity per delivery", value: (s) => s.quantity_per_delivery },
    { header: "Frequency", value: (s) => s.frequency },
    { header: "Total weeks", value: (s) => s.total_weeks },
    { header: "Status", value: (s) => s.status },
    { header: "Payment status", value: (s) => s.payment_status },
    { header: "Total amount", value: (s) => s.total_amount },
    { header: "Started", value: (s) => s.created_at },
    { header: "Derived end", value: (s) => s.derived_end_date ?? "" },
    { header: "Remaining deliveries", value: (s) => s.remaining_deliveries ?? "" },
  ]);
  downloadCsv(csvFilename("subscriptions"), csv);
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

const chipBase: React.CSSProperties = {
  padding: "0.35rem 0.85rem",
  border: "1px solid rgba(245,158,11,0.4)",
  fontFamily: "var(--font-body)",
  fontSize: "0.65rem",
  letterSpacing: "0.22em",
  background: "transparent",
  cursor: "pointer",
  textTransform: "uppercase",
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
  color: "#fbf3d4",
  fontSize: "0.85rem",
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
