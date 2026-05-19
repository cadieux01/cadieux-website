"use client";

// Subscriptions admin board. Calls the enriched
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
import {
  AdminDeliveryRow,
  AdminSubscriptionRow,
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_OPTIONS,
  SUBSCRIPTION_PAYMENT_STATUSES,
  SUBSCRIPTION_STATUSES,
} from "@/lib/admin-shared";

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
  const [refreshing, setRefreshing] = useState(false);
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
      else if (e instanceof Error) setError(e.message);
      else setError("Could not load subscriptions.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  // 10s polling — same cadence as the legacy admin dashboard.
  useEffect(() => {
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [load]);

  const [drawerId, setDrawerId] = useState<string | null>(null);
  const drawerSub = useMemo(
    () => (drawerId ? subs.find((s) => s.id === drawerId) ?? null : null),
    [drawerId, subs],
  );

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
      title="Subscriptions"
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
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
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
                        <button
                          type="button"
                          onClick={() => setDrawerId(s.id)}
                          style={buttonSm}
                        >
                          Open
                        </button>
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
        </div>
      )}

      {drawerSub ? (
        <SubscriptionDrawer
          subscription={drawerSub}
          onClose={() => setDrawerId(null)}
          onChanged={() => void load()}
        />
      ) : null}

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

function SubscriptionDrawer({
  subscription,
  onClose,
  onChanged,
}: {
  subscription: AdminSubscriptionRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [deliveries, setDeliveries] = useState<AdminDeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDeliveries = useCallback(async () => {
    try {
      const r = await adminFetch<{ deliveries: AdminDeliveryRow[] }>(
        `/api/admin/subscriptions/${subscription.id}/deliveries`,
      );
      setDeliveries(r.deliveries ?? []);
      setError(null);
    } catch (e) {
      setError(
        e instanceof AdminFetchError ? e.message : "Failed to load deliveries.",
      );
    } finally {
      setLoading(false);
    }
  }, [subscription.id]);

  useEffect(() => {
    void fetchDeliveries();
    const t = setInterval(() => void fetchDeliveries(), 10_000);
    return () => clearInterval(t);
  }, [fetchDeliveries]);

  const updateOverallStatus = async (next: string) => {
    try {
      await adminFetch(`/api/admin/subscriptions/${subscription.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      onChanged();
    } catch (e) {
      alert(e instanceof AdminFetchError ? e.message : "Update failed.");
    }
  };

  const updatePaymentStatus = async (next: string) => {
    try {
      await adminFetch(`/api/admin/subscriptions/${subscription.id}`, {
        method: "PATCH",
        body: JSON.stringify({ payment_status: next }),
      });
      onChanged();
    } catch (e) {
      alert(e instanceof AdminFetchError ? e.message : "Update failed.");
    }
  };

  const updateDeliveryStatus = async (deliveryId: string, next: string) => {
    const prev = deliveries;
    setDeliveries((curr) =>
      curr.map((d) => (d.id === deliveryId ? { ...d, status: next } : d)),
    );
    try {
      await adminFetch(
        `/api/admin/subscriptions/${subscription.id}/deliveries/${deliveryId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: next }),
        },
      );
      void fetchDeliveries();
      onChanged();
    } catch (e) {
      setDeliveries(prev);
      alert(
        e instanceof AdminFetchError ? e.message : "Delivery update failed.",
      );
    }
  };

  const updateDeliveryNotes = async (deliveryId: string, notes: string) => {
    try {
      await adminFetch(
        `/api/admin/subscriptions/${subscription.id}/deliveries/${deliveryId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ admin_notes: notes }),
        },
      );
      void fetchDeliveries();
    } catch (e) {
      alert(
        e instanceof AdminFetchError ? e.message : "Notes update failed.",
      );
    }
  };

  const addr = subscription.delivery_address ?? null;
  const addrLine = addr
    ? [addr.line1, addr.line2, addr.city, addr.pincode].filter(Boolean).join(", ")
    : "";

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        style={{
          width: "min(620px, 100%)",
          maxHeight: "100dvh",
          height: "100dvh",
          background: "#0e0e0e",
          borderLeft: "1px solid rgba(245,158,11,0.25)",
          overflowY: "auto",
          overscrollBehavior: "contain",
          padding:
            "28px 28px calc(60px + env(safe-area-inset-bottom)) 28px",
          color: "#fbf3d4",
          fontFamily: "var(--font-body)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 18,
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                fontSize: "0.65rem",
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: "rgba(245,158,11,0.75)",
              }}
            >
              Subscription
            </p>
            <p
              style={{
                margin: "4px 0 0",
                fontFamily: "var(--font-heading)",
                fontSize: "1.5rem",
                fontWeight: 300,
                letterSpacing: "0.04em",
              }}
            >
              {subscription.product_name} × {subscription.quantity_per_delivery}
            </p>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: "0.75rem",
                color: "rgba(251,243,212,0.55)",
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span>
                {subscription.customer?.full_name ?? "—"} ·{" "}
                {subscription.customer?.phone ?? "—"}
              </span>
              {subscription.customer?.phone ? (
                <ContactActions
                  phone={subscription.customer.phone}
                  customerName={subscription.customer.full_name}
                  orderInfo={`${subscription.product_name} subscription`}
                />
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "rgba(251,243,212,0.55)",
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            background: "rgba(245,158,11,0.05)",
            border: "1px solid rgba(245,158,11,0.35)",
            padding: "14px 16px",
            marginBottom: 18,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: "0.6rem",
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: "rgba(245,158,11,0.8)",
              }}
            >
              Overall status
            </span>
            <select
              value={subscription.status}
              onChange={(e) => void updateOverallStatus(e.target.value)}
              style={drawerSelect}
            >
              {SUBSCRIPTION_STATUSES.map((opt) => (
                <option key={opt} value={opt} style={{ color: "#000" }}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: "0.6rem",
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: "rgba(251,243,212,0.5)",
              }}
            >
              Payment
            </span>
            <select
              value={subscription.payment_status}
              onChange={(e) => void updatePaymentStatus(e.target.value)}
              style={drawerSelect}
            >
              {SUBSCRIPTION_PAYMENT_STATUSES.map((opt) => (
                <option key={opt} value={opt} style={{ color: "#000" }}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.78rem",
            }}
          >
            <span style={{ color: "rgba(251,243,212,0.5)" }}>Plan</span>
            <span>
              {subscription.frequency} · {subscription.day_of_week ?? "—"} ·{" "}
              {subscription.time_slot ?? "—"}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.78rem",
            }}
          >
            <span style={{ color: "rgba(251,243,212,0.5)" }}>Total</span>
            <span>
              {formatINR(subscription.total_amount)} · {subscription.total_weeks} weeks
            </span>
          </div>
          {addrLine ? (
            <div
              style={{
                fontSize: "0.75rem",
                color: "rgba(251,243,212,0.55)",
                lineHeight: 1.5,
              }}
            >
              {addr?.name ? (
                <>
                  <b style={{ color: "#fbf3d4", fontWeight: 500 }}>{addr.name}</b>
                  <br />
                </>
              ) : null}
              {addrLine}
            </div>
          ) : null}
        </div>

        <p
          style={{
            margin: "0 0 14px",
            fontSize: "0.6rem",
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "rgba(245,158,11,0.75)",
          }}
        >
          Deliveries · {deliveries.length}
        </p>

        {loading ? (
          <p style={{ color: "rgba(251,243,212,0.45)" }}>Loading…</p>
        ) : null}
        {error ? <p style={{ color: "#e05a5a" }}>Error: {error}</p> : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {deliveries.map((d) => (
            <DeliveryCard
              key={d.id}
              delivery={d}
              onStatusChange={(next) => void updateDeliveryStatus(d.id, next)}
              onNotesSave={(notes) => void updateDeliveryNotes(d.id, notes)}
            />
          ))}
          {!loading && deliveries.length === 0 && !error ? (
            <p style={{ color: "rgba(251,243,212,0.45)", fontSize: "0.78rem" }}>
              No deliveries scheduled.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DeliveryCard({
  delivery,
  onStatusChange,
  onNotesSave,
}: {
  delivery: AdminDeliveryRow;
  onStatusChange: (s: string) => void;
  onNotesSave: (notes: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(delivery.admin_notes ?? "");
  const userEdited = (delivery.admin_notes ?? "").includes("[user edit");
  return (
    <div
      style={{
        border: "1px solid rgba(245,158,11,0.2)",
        background: "rgba(245,158,11,0.03)",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: "0.65rem",
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            color: "rgba(245,158,11,0.75)",
          }}
        >
          Week {delivery.week_number}
        </span>
        <select
          value={delivery.status}
          onChange={(e) => onStatusChange(e.target.value)}
          style={drawerSelect}
        >
          {DELIVERY_STATUS_OPTIONS.map((opt) => (
            <option key={opt} value={opt} style={{ color: "#000" }}>
              {DELIVERY_STATUS_LABELS[opt] ?? opt}
            </option>
          ))}
        </select>
      </div>
      <div style={{ fontSize: "0.85rem", color: "#fbf3d4" }}>
        {formatScheduledDate(delivery.scheduled_date)}
        <span style={{ color: "rgba(251,243,212,0.5)" }}>
          {" "}
          · {delivery.scheduled_time_slot}
        </span>
      </div>
      {delivery.status_updated_at ? (
        <div
          style={{
            fontSize: "0.65rem",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "rgba(251,243,212,0.35)",
          }}
        >
          Updated ·{" "}
          {new Date(delivery.status_updated_at).toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
          })}
        </div>
      ) : null}
      {userEdited ? (
        <span
          style={{
            alignSelf: "flex-start",
            fontSize: "0.6rem",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#7bd88f",
            border: "1px solid rgba(123,216,143,0.5)",
            padding: "2px 8px",
            borderRadius: 999,
          }}
        >
          ✎ User edited
        </span>
      ) : null}
      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            style={{
              background: "transparent",
              border: "1px solid rgba(245,158,11,0.3)",
              color: "#fbf3d4",
              padding: "0.45rem 0.6rem",
              fontFamily: "var(--font-body)",
              fontSize: "0.8rem",
              resize: "vertical",
              outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => {
                setDraft(delivery.admin_notes ?? "");
                setEditing(false);
              }}
              style={buttonSm}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onNotesSave(draft);
                setEditing(false);
              }}
              style={buttonSm}
            >
              Save
            </button>
          </div>
        </div>
      ) : delivery.admin_notes ? (
        <div
          style={{
            fontSize: "0.75rem",
            color: "rgba(251,243,212,0.6)",
            fontStyle: "italic",
            whiteSpace: "pre-wrap",
          }}
        >
          Notes: {delivery.admin_notes}{" "}
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{
              ...buttonSm,
              fontSize: "0.55rem",
              padding: "0.15rem 0.5rem",
              marginLeft: 6,
            }}
          >
            Edit notes
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          style={{
            ...buttonSm,
            fontSize: "0.6rem",
            padding: "0.2rem 0.6rem",
            alignSelf: "flex-start",
          }}
        >
          Add notes
        </button>
      )}
    </div>
  );
}

function formatScheduledDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const drawerSelect: React.CSSProperties = {
  background: "rgba(0,0,0,0.4)",
  color: "#fbf3d4",
  border: "1px solid rgba(245,158,11,0.4)",
  padding: "5px 10px",
  fontFamily: "var(--font-body)",
  fontSize: "0.72rem",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  cursor: "pointer",
};

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
