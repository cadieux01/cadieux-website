"use client";

// Delivery Changes — admin queue for COD order delivery change-requests
// submitted by customers from the order tracking page. Mirrors
// /admin/change-requests (subscription reschedules): filter chips, current
// vs requested diff, required-response-on-reject, approve/reject buttons,
// and a "Recent · last 7 days" panel under the pending view.
//
// Approve calls PATCH /api/admin/order-change-requests/[id] which runs the
// SECURITY DEFINER approve_order_change_request RPC (atomic re-check + apply
// to the order). Reject leaves the order untouched.

import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { ContactActions } from "@/components/admin/ContactActions";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatSlotForDisplay } from "@/lib/delivery-slots";

type OrderInfo = {
  id: string;
  customer_id: string;
  status: string;
  payment_method: string | null;
  payment_status: string | null;
  delivery_date: string | null;
  delivery_slot: string | null;
  delivery_address: string | null;
} | null;

type DeliveryRequest = {
  id: string;
  order_id: string;
  status: string;
  requested_delivery_date: string | null;
  requested_delivery_slot: string | null;
  requested_delivery_address: string | null;
  reason: string | null;
  admin_response: string | null;
  created_at: string;
  resolved_at: string | null;
  order: OrderInfo;
  customer?: { full_name: string | null; phone: string | null } | null;
};

type Filter = "pending" | "approved" | "rejected" | "cancelled" | "all";

export default function OrderChangesPage() {
  const [rows, setRows] = useState<DeliveryRequest[]>([]);
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
      const res = await adminFetch<{ requests: DeliveryRequest[] }>(
        "/api/admin/order-change-requests?status=all",
      );
      setRows(res.requests ?? []);
    } catch (e) {
      setError(
        e instanceof AdminFetchError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not load delivery change requests.",
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
      await adminFetch(`/api/admin/order-change-requests/${id}`, {
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
      title="Delivery Changes"
      subtitle="COD delivery change queue"
      actions={
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="uppercase"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.7rem",
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
        {(["pending", "approved", "rejected", "cancelled", "all"] as Filter[]).map(
          (f) => {
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
                  fontSize: "0.65rem",
                  letterSpacing: "0.22em",
                  cursor: "pointer",
                }}
              >
                {f}
                <span style={{ marginLeft: 8, opacity: 0.7 }}>
                  {counts[f] ?? 0}
                </span>
              </button>
            );
          },
        )}
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
        <p style={mutedText}>Loading…</p>
      ) : filtered.length === 0 ? (
        <p style={mutedText}>
          No {filter === "all" ? "" : filter + " "}delivery change requests.
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
                  : r.status === "cancelled"
                    ? "rgba(251,243,212,0.5)"
                    : "#e3b341";
            const order = r.order;
            const shortId = r.order_id.slice(0, 8).toUpperCase();
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
                  fontSize: "0.82rem",
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
                      <a
                        href={`/admin/orders/${r.order_id}`}
                        style={{ color: "#fbf3d4", textDecoration: "none" }}
                      >
                        Order #{shortId}
                      </a>
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        color: "rgba(251,243,212,0.6)",
                        fontSize: "0.78rem",
                      }}
                    >
                      {r.customer?.full_name ?? "—"} · {r.customer?.phone ?? "—"}
                    </div>
                    {order ? (
                      <div
                        style={{
                          marginTop: 2,
                          color: "rgba(251,243,212,0.45)",
                          fontSize: "0.72rem",
                          textTransform: "uppercase",
                          letterSpacing: "0.12em",
                        }}
                      >
                        {order.payment_method ?? "—"} ·{" "}
                        {order.payment_status ?? "—"} · {order.status}
                      </div>
                    ) : null}
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
                        orderInfo={`delivery change request for order #${shortId}`}
                      />
                    ) : null}
                    <span
                      className="uppercase"
                      style={{
                        color: statusColor,
                        border: `1px solid ${statusColor}`,
                        padding: "4px 12px",
                        fontSize: "0.6rem",
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
                    fontSize: "0.78rem",
                    paddingTop: 6,
                    borderTop: "1px solid rgba(245,158,11,0.1)",
                  }}
                >
                  <div>
                    <div style={smallLabel}>Current</div>
                    <div style={{ color: "rgba(251,243,212,0.7)" }}>
                      {formatScheduledDate(order?.delivery_date ?? null)}
                    </div>
                    <div
                      style={{
                        color: "rgba(251,243,212,0.5)",
                        fontSize: "0.72rem",
                      }}
                    >
                      {formatSlotForDisplay(order?.delivery_slot) || "—"}
                    </div>
                    <div
                      style={{
                        color: "rgba(251,243,212,0.5)",
                        fontSize: "0.72rem",
                        marginTop: 2,
                      }}
                    >
                      {order?.delivery_address ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div style={{ ...smallLabel, color: "rgba(245,158,11,0.7)" }}>
                      Requested
                    </div>
                    {r.requested_delivery_date ? (
                      <div style={{ color: "rgba(251,243,212,0.85)" }}>
                        {formatScheduledDate(r.requested_delivery_date)}
                      </div>
                    ) : null}
                    {r.requested_delivery_slot ? (
                      <div
                        style={{
                          color: "rgba(251,243,212,0.6)",
                          fontSize: "0.72rem",
                        }}
                      >
                        {formatSlotForDisplay(r.requested_delivery_slot)}
                      </div>
                    ) : null}
                    {r.requested_delivery_address ? (
                      <div
                        style={{
                          color: "rgba(251,243,212,0.85)",
                          fontSize: "0.72rem",
                          marginTop: 2,
                        }}
                      >
                        {r.requested_delivery_address}
                      </div>
                    ) : null}
                    {!r.requested_delivery_date &&
                    !r.requested_delivery_slot &&
                    !r.requested_delivery_address ? (
                      <span style={{ color: "rgba(251,243,212,0.5)" }}>—</span>
                    ) : null}
                  </div>
                </div>

                {r.reason ? (
                  <div
                    style={{
                      fontSize: "0.78rem",
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
                    style={{ fontSize: "0.75rem", color: "rgba(251,243,212,0.6)" }}
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
                        if (errors[r.id])
                          setErrors((es) => ({ ...es, [r.id]: "" }));
                      }}
                      rows={2}
                      style={{
                        width: "100%",
                        background: "rgba(0,0,0,0.4)",
                        border: `1px solid ${errors[r.id] ? "rgba(255,129,129,0.7)" : "rgba(245,158,11,0.25)"}`,
                        color: "#fbf3d4",
                        padding: "8px 10px",
                        fontFamily: "var(--font-body)",
                        fontSize: "0.78rem",
                        resize: "vertical",
                      }}
                    />
                    {errors[r.id] ? (
                      <div style={{ color: "#ff8181", fontSize: "0.72rem" }}>
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
                          fontSize: "0.65rem",
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
                          fontSize: "0.65rem",
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
                  style={{ fontSize: "0.7rem", color: "rgba(251,243,212,0.4)" }}
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
                    fontSize: "0.78rem",
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
                      Order #{r.order_id.slice(0, 8).toUpperCase()}
                    </span>
                    <span
                      style={{
                        color: "rgba(251,243,212,0.5)",
                        fontSize: "0.72rem",
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
                      fontSize: "0.58rem",
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

function formatScheduledDate(iso: string | null): string {
  if (!iso) return "—";
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
  fontSize: "0.85rem",
};

const smallLabel: React.CSSProperties = {
  fontSize: "0.6rem",
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: "rgba(251,243,212,0.45)",
  marginBottom: 4,
};
