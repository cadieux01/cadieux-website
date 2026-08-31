"use client";

// Change Requests — admin queue for subscription delivery reschedules
// submitted by customers. Mirrors the legacy /admin section's
// ChangeRequestsSection: filter chips (pending/approved/rejected/all),
// required-response-on-reject, approve/reject buttons, and a "Recent ·
// last 7 days" panel underneath when viewing pending.

import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { ContactActions } from "@/components/admin/ContactActions";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";

type ChangeRequest = {
  id: string;
  delivery_id: string;
  subscription_id: string;
  requested_date: string | null;
  requested_time_slot: string | null;
  reason: string | null;
  status: string;
  admin_response: string | null;
  created_at: string;
  delivery?: {
    week_number: number;
    scheduled_date: string;
    scheduled_time_slot: string;
    status: string;
  } | null;
  subscription?: { product_name: string; total_weeks: number } | null;
  customer?: { full_name: string | null; phone: string | null } | null;
};

type Filter = "pending" | "approved" | "rejected" | "all";

export default function ChangeRequestsPage() {
  const [rows, setRows] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await adminFetch<{ requests: ChangeRequest[] }>(
        "/api/admin/change-requests?status=all",
      );
      setRows(res.requests ?? []);
    } catch (e) {
      setError(
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
          ? e.message
          : "Could not load change requests.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

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

  const filtered = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const recentResolved = useMemo(
    () =>
      rows.filter((r) => {
        if (r.status !== "approved" && r.status !== "rejected") return false;
        return Date.now() - new Date(r.created_at).getTime() < SEVEN_DAYS_MS;
      }),
    [rows, SEVEN_DAYS_MS],
  );

  const act = async (id: string, action: "approve" | "reject") => {
    const response = (responses[id] ?? "").trim();
    if (action === "reject" && !response) {
      setErrors((e) => ({ ...e, [id]: "A response is required when rejecting." }));
      return;
    }
    setErrors((e) => ({ ...e, [id]: "" }));
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await adminFetch(`/api/admin/change-requests/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action, admin_response: response || null }),
      });
      await load();
    } catch (e) {
      alert(e instanceof AdminFetchError ? e.message : "Action failed.");
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  return (
    <AdminShell
      title="Change Requests"
      subtitle="Subscription reschedule queue"
      actions={
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="uppercase"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            letterSpacing: "0.25em",
            color: "#f59e0b",
            border: "1px solid #f59e0b",
            padding: "0.45rem 0.9rem",
            background: "transparent",
            cursor: refreshing ? "wait" : "pointer",
            opacity: refreshing ? 0.6 : 1,
          }}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      <div className="flex flex-wrap gap-2 mb-5">
        {(["pending", "approved", "rejected", "all"] as Filter[]).map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className="uppercase"
              style={{
                background: active ? "rgba(245,158,11,0.15)" : "transparent",
                border: `1px solid ${active ? "rgba(245,158,11,0.7)" : "rgba(245,158,11,0.25)"}`,
                color: active ? "#fbf3d4" : "rgba(251,243,212,0.55)",
                padding: "6px 14px",
                fontFamily: "var(--font-body)",
                fontSize: "0.875rem",
                letterSpacing: "0.22em",
                cursor: "pointer",
              }}
            >
              {f}
              <span style={{ marginLeft: 8, opacity: 0.7 }}>{counts[f] ?? 0}</span>
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
            fontSize: "1rem",
            fontFamily: "var(--font-body)",
          }}
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <p style={mutedText}>Loading…</p>
      ) : filtered.length === 0 ? (
        <p style={mutedText}>
          No {filter === "all" ? "" : filter + " "}change requests.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {filtered.map((r) => {
            const isPending = r.status === "pending";
            const statusColor =
              r.status === "approved"
                ? "#7bd88f"
                : r.status === "rejected"
                  ? "#ff8181"
                  : "#e3b341";
            return (
              <div
                key={r.id}
                style={{
                  border: "1px solid rgba(245,158,11,0.18)",
                  background: "rgba(245,158,11,0.03)",
                  padding: "16px 18px",
                  display: "grid",
                  gap: 10,
                  fontFamily: "var(--font-body)",
                  color: "#fbf3d4",
                  fontSize: "1rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontWeight: 300,
                        fontSize: "1rem",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {r.subscription?.product_name ?? "—"}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        color: "rgba(251,243,212,0.6)",
                        fontSize: "1rem",
                      }}
                    >
                      {r.customer?.full_name ?? "—"} · {r.customer?.phone ?? "—"}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    {r.customer?.phone ? (
                      <ContactActions
                        phone={r.customer.phone}
                        customerName={r.customer.full_name}
                        orderInfo={
                          r.subscription?.product_name
                            ? `change request${r.delivery?.week_number ? ` for Week ${r.delivery.week_number}` : ""} of ${r.subscription.product_name}`
                            : null
                        }
                      />
                    ) : null}
                    <span
                      className="uppercase"
                      style={{
                        color: statusColor,
                        border: `1px solid ${statusColor}`,
                        padding: "4px 12px",
                        fontSize: "0.875rem",
                        letterSpacing: "0.22em",
                      }}
                    >
                      {r.status}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                    fontSize: "1rem",
                    paddingTop: 6,
                    borderTop: "1px solid rgba(245,158,11,0.1)",
                  }}
                >
                  <div>
                    <div style={smallLabel}>Original</div>
                    {r.delivery ? (
                      <>
                        <div>Week {r.delivery.week_number}</div>
                        <div style={{ color: "rgba(251,243,212,0.7)" }}>
                          {formatScheduledDate(r.delivery.scheduled_date)}
                        </div>
                        <div
                          style={{
                            color: "rgba(251,243,212,0.5)",
                            fontSize: "1rem",
                          }}
                        >
                          {r.delivery.scheduled_time_slot}
                        </div>
                      </>
                    ) : (
                      <span style={{ color: "rgba(251,243,212,0.5)" }}>—</span>
                    )}
                  </div>
                  <div>
                    <div
                      style={{
                        ...smallLabel,
                        color: "rgba(245,158,11,0.7)",
                      }}
                    >
                      Requested
                    </div>
                    {r.requested_date ? (
                      <div style={{ color: "rgba(251,243,212,0.85)" }}>
                        {formatScheduledDate(r.requested_date)}
                      </div>
                    ) : null}
                    {r.requested_time_slot ? (
                      <div
                        style={{
                          color: "rgba(251,243,212,0.6)",
                          fontSize: "1rem",
                        }}
                      >
                        {r.requested_time_slot}
                      </div>
                    ) : null}
                    {!r.requested_date && !r.requested_time_slot ? (
                      <span style={{ color: "rgba(251,243,212,0.5)" }}>—</span>
                    ) : null}
                  </div>
                </div>

                {r.reason ? (
                  <div
                    style={{
                      fontSize: "1rem",
                      color: "rgba(251,243,212,0.7)",
                      fontStyle: "italic",
                      borderLeft: "2px solid rgba(245,158,11,0.4)",
                      paddingLeft: 10,
                    }}
                  >
                    &ldquo;{r.reason}&rdquo;
                  </div>
                ) : null}

                {!isPending && r.admin_response ? (
                  <div
                    style={{ fontSize: "1rem", color: "rgba(251,243,212,0.6)" }}
                  >
                    <span style={{ color: "rgba(245,158,11,0.7)" }}>Response:</span>{" "}
                    {r.admin_response}
                  </div>
                ) : null}

                {isPending ? (
                  <>
                    <textarea
                      placeholder="Response to customer (required to reject)…"
                      value={responses[r.id] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setResponses((vs) => ({ ...vs, [r.id]: v }));
                        if (errors[r.id]) setErrors((es) => ({ ...es, [r.id]: "" }));
                      }}
                      rows={2}
                      style={{
                        width: "100%",
                        background: "rgba(0,0,0,0.4)",
                        border: `1px solid ${errors[r.id] ? "rgba(255,129,129,0.7)" : "rgba(245,158,11,0.25)"}`,
                        color: "#fbf3d4",
                        padding: "8px 10px",
                        fontFamily: "var(--font-body)",
                        fontSize: "1rem",
                        resize: "vertical",
                      }}
                    />
                    {errors[r.id] ? (
                      <div style={{ color: "#ff8181", fontSize: "1rem" }}>
                        {errors[r.id]}
                      </div>
                    ) : null}
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        justifyContent: "flex-end",
                      }}
                    >
                      <button
                        type="button"
                        disabled={busy[r.id]}
                        onClick={() => void act(r.id, "reject")}
                        className="uppercase"
                        style={{
                          background: "transparent",
                          border: "1px solid rgba(255,129,129,0.55)",
                          color: "#ff8181",
                          padding: "6px 14px",
                          fontFamily: "var(--font-body)",
                          fontSize: "0.875rem",
                          letterSpacing: "0.2em",
                          cursor: busy[r.id] ? "not-allowed" : "pointer",
                          opacity: busy[r.id] ? 0.5 : 1,
                        }}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        disabled={busy[r.id]}
                        onClick={() => void act(r.id, "approve")}
                        className="uppercase"
                        style={{
                          background: "rgba(123,216,143,0.12)",
                          border: "1px solid rgba(123,216,143,0.55)",
                          color: "#7bd88f",
                          padding: "6px 14px",
                          fontFamily: "var(--font-body)",
                          fontSize: "0.875rem",
                          letterSpacing: "0.2em",
                          cursor: busy[r.id] ? "not-allowed" : "pointer",
                          opacity: busy[r.id] ? 0.5 : 1,
                        }}
                      >
                        Approve
                      </button>
                    </div>
                  </>
                ) : null}

                <div
                  style={{
                    fontSize: "1rem",
                    color: "rgba(251,243,212,0.4)",
                  }}
                >
                  Submitted{" "}
                  {new Date(r.created_at).toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {filter === "pending" && recentResolved.length > 0 ? (
        <div style={{ marginTop: 36 }}>
          <h3
            className="uppercase"
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "0.95rem",
              letterSpacing: "0.3em",
              color: "rgba(251,243,212,0.65)",
              fontWeight: 300,
              margin: "0 0 12px",
            }}
          >
            Recent · last 7 days
          </h3>
          <div style={{ display: "grid", gap: 8 }}>
            {recentResolved.map((r) => {
              const sc = r.status === "approved" ? "#7bd88f" : "#ff8181";
              return (
                <div
                  key={r.id}
                  style={{
                    border: "1px solid rgba(245,158,11,0.12)",
                    background: "rgba(255,255,255,0.015)",
                    padding: "10px 14px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    fontFamily: "var(--font-body)",
                    color: "rgba(251,243,212,0.75)",
                    fontSize: "1rem",
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      minWidth: 0,
                    }}
                  >
                    <span style={{ color: "#fbf3d4" }}>
                      {r.subscription?.product_name ?? "—"}
                      {r.delivery ? ` · Week ${r.delivery.week_number}` : ""}
                    </span>
                    <span
                      style={{
                        color: "rgba(251,243,212,0.5)",
                        fontSize: "1rem",
                      }}
                    >
                      {r.customer?.full_name ?? "—"} ·{" "}
                      {new Date(r.created_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </div>
                  <span
                    className="uppercase"
                    style={{
                      color: sc,
                      border: `1px solid ${sc}`,
                      padding: "3px 10px",
                      fontSize: "0.875rem",
                      letterSpacing: "0.22em",
                    }}
                  >
                    {r.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </AdminShell>
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

const mutedText: React.CSSProperties = {
  color: "rgba(192,200,206,0.5)",
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
};

const smallLabel: React.CSSProperties = {
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: "rgba(251,243,212,0.45)",
  marginBottom: 4,
};
