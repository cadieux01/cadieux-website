"use client";

// Today's Orders — operational view used during dispatch hours.
//
// Reads /api/admin/orders (admin-token-gated GET) and lets the operator
// filter by status, search by customer name/phone, sort by created_at
// or by delivery_date, and run per-row PATCH actions that match the
// transitions the existing /api/admin/orders/[id] endpoint accepts.
//
// Live columns surfaced (post the orders.delivery_date + items
// migration): delivery_date, delivery_slot, items jsonb. Rows that
// predate the migration (where these are null) fall back to created_at
// for the "Delivery" column and a single-line "—" for items.

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import {
  DateRangeDropdown,
  resolvePreset,
  toYMD,
  withinDateRange,
  type DateRangeValue,
} from "@/components/admin/DateRangeDropdown";
import { ContactActions } from "@/components/admin/ContactActions";
import { OrderLocationActions } from "@/components/admin/OrderLocationActions";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { adminAuthHeaders, adminFetch, AdminFetchError } from "@/lib/admin-client";
import { csvFilename, downloadCsv, toCsv } from "@/lib/admin-csv";
import {
  formatDate,
  formatDateTime,
  formatINR,
} from "@/lib/admin-formatting";
import {
  AdminOrderRow,
  ORDER_FILTER_VALUES,
  ORDER_STATUSES,
  OrderFilterValue,
  OrderStatus,
} from "@/lib/admin-shared";
import {
  sendCustomerEditSMS,
  sendOrderStatusSMS,
  sendOrderWhatsApp,
  toNotifyStatus,
} from "@/lib/admin-notify";
import Select from "@/components/ui/Select";

type SortKey = "created_desc" | "delivery_asc";

const NEXT_STATUS_DELIVERY: Record<string, OrderStatus | null> = {
  pending_payment: "confirmed",
  placed: "confirmed",
  confirmed: "preparing",
  preparing: "out_for_delivery",
  out_for_delivery: "delivered",
  delivered: null,
  cancelled: null,
  // legacy aliases — handled so historic rows still get a sane "next"
  pending: "confirmed",
  dispatched: "delivered",
};

// Pickup skips preparing + out_for_delivery. The stall side goes:
// placed → confirmed → ready_for_pickup → picked_up.
const NEXT_STATUS_PICKUP: Record<string, OrderStatus | null> = {
  pending_payment: "confirmed",
  placed: "confirmed",
  confirmed: "ready_for_pickup",
  ready_for_pickup: "picked_up",
  picked_up: null,
  cancelled: null,
  pending: "confirmed",
};

/** Returns the next status this order should transition to, or null if it's
 *  already at a terminal stage. Branches on fulfillment_type; legacy rows
 *  with no value are treated as delivery. */
function nextStatusFor(order: AdminOrderRow): OrderStatus | null {
  const key = (order.status ?? "").toLowerCase();
  const map =
    order.fulfillment_type === "pickup"
      ? NEXT_STATUS_PICKUP
      : NEXT_STATUS_DELIVERY;
  return map[key] ?? null;
}

type BulkAction = "confirm" | "prepare" | "dispatch" | "deliver" | "cancel";

type BulkResult = {
  succeeded: string[];
  failed: { id: string; error: string }[];
  action: BulkAction;
};

// Suspense wrapper required by Next.js prerender for any client page
// that reads useSearchParams() — useDateRangeFromQuery does, so the
// boundary lives at the page export.
export default function OrdersPage() {
  return (
    <Suspense fallback={<AdminLoading />}>
      <OrdersPageInner />
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

function OrdersPageInner() {
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<OrderFilterValue>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("created_desc");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingBulk, setPendingBulk] = useState<BulkAction | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [range, setRange] = useState<DateRangeValue | null>(() =>
    resolvePreset("this_month"),
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await adminFetch<{ orders: AdminOrderRow[] }>(
        "/api/admin/orders",
      );
      setOrders(res.orders ?? []);
    } catch (e) {
      if (e instanceof AdminFetchError) setError(e.message);
      else if (e instanceof Error) setError(e.message);
      else setError("Could not load orders.");
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

  // 10s polling — matches the legacy admin dashboard cadence. We keep
  // this lightweight: the same /api/admin/orders endpoint is hit every
  // tick (it's a small payload and the admin is one user). Cleared on
  // unmount.
  useEffect(() => {
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [load]);

  const [editing, setEditing] = useState<AdminOrderRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const showNotice = useCallback((m: string) => {
    setNotice(m);
    setTimeout(() => setNotice(null), 4000);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders
      .filter((o) => {
        if (!withinDateRange(o.created_at, range)) return false;
        if (filter !== "all") {
          if (filter === "expired") {
            // 'expired' is a computed lifecycle state (not a stored status).
            // Match server-attached computed_state; see src/lib/order-state.ts.
            if (o.computed_state !== "expired") return false;
          } else if ((o.status ?? "").toLowerCase() !== filter) {
            return false;
          }
        }
        if (!q) return true;
        const name = (o.customers?.full_name ?? "").toLowerCase();
        const phone = (o.customers?.phone ?? "").toLowerCase();
        return name.includes(q) || phone.includes(q);
      })
      .sort((a, b) => {
        if (sort === "delivery_asc") {
          // delivery_date is YYYY-MM-DD (lex-sortable). Rows that
          // predate the migration fall back to created_at so they
          // still appear at a stable position in the queue.
          const aKey = a.delivery_date ?? a.created_at.slice(0, 10);
          const bKey = b.delivery_date ?? b.created_at.slice(0, 10);
          const cmp = aKey.localeCompare(bKey);
          if (cmp !== 0) return cmp;
          // Tie-break by slot then created_at so packing groups stay
          // contiguous within a day.
          const aSlot = a.delivery_slot ?? "";
          const bSlot = b.delivery_slot ?? "";
          const slotCmp = aSlot.localeCompare(bSlot);
          if (slotCmp !== 0) return slotCmp;
          return a.created_at.localeCompare(b.created_at);
        }
        return b.created_at.localeCompare(a.created_at);
      });
  }, [orders, filter, query, sort, range]);

  // Counts are scoped to the active date range so the chip badges
  // match the rows the operator is actually looking at.
  const counts = useMemo(() => {
    const inRange = orders.filter((o) => withinDateRange(o.created_at, range));
    const c: Record<string, number> = { all: inRange.length };
    for (const o of inRange) {
      const k = (o.status ?? "").toLowerCase();
      c[k] = (c[k] ?? 0) + 1;
      // 'expired' is a computed lifecycle state (server-attached
      // computed_state; see src/lib/order-state.ts). Bucket it as an
      // extra chip count on top of its underlying status ('pending').
      if (o.computed_state === "expired") {
        c.expired = (c.expired ?? 0) + 1;
      }
    }
    return c;
  }, [orders, range]);

  const advance = async (order: AdminOrderRow) => {
    const next = nextStatusFor(order);
    if (!next) return;
    await patchStatus(order, next);
  };

  const toggleSelect = (id: string) => {
    setSelected((curr) => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const masterChecked =
    filtered.length > 0 && filtered.every((o) => selected.has(o.id));
  const someSelected = filtered.some((o) => selected.has(o.id));

  const toggleSelectAll = () => {
    setSelected((curr) => {
      if (masterChecked) {
        // Clear only the currently-visible ids so selections on other
        // filters aren't lost when the operator toggles.
        const next = new Set(curr);
        for (const o of filtered) next.delete(o.id);
        return next;
      }
      const next = new Set(curr);
      for (const o of filtered) next.add(o.id);
      return next;
    });
  };

  const runBulk = async (action: BulkAction) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkRunning(true);
    try {
      const res = await adminFetch<{
        succeeded: string[];
        failed: { id: string; error: string }[];
      }>("/api/admin/orders/bulk", {
        method: "POST",
        body: JSON.stringify({ orderIds: ids, action }),
      });
      setBulkResult({ ...res, action });
      // Drop succeeded ids from selection and refetch so the UI matches
      // the canonical server state.
      setSelected((curr) => {
        const next = new Set(curr);
        for (const id of res.succeeded) next.delete(id);
        return next;
      });
      await load();
    } catch (e) {
      const msg =
        e instanceof AdminFetchError ? e.message : "Bulk action failed.";
      setBulkResult({ succeeded: [], failed: ids.map((id) => ({ id, error: msg })), action });
    } finally {
      setBulkRunning(false);
      setPendingBulk(null);
    }
  };

  const patchStatus = async (order: AdminOrderRow, next: OrderStatus) => {
    setBusyId(order.id);
    // Optimistic — flip the status locally and roll back on failure.
    const prev = orders;
    setOrders((curr) =>
      curr.map((o) => (o.id === order.id ? { ...o, status: next } : o)),
    );
    try {
      await adminFetch(`/api/admin/orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      // Mirror legacy: SMS + WhatsApp on every status change we have
      // copy for. Both are fire-and-forget; failures surface in a toast
      // but never roll back the status update.
      const phone = order.customers?.phone;
      const name = order.customers?.full_name ?? "Customer";
      const notify = toNotifyStatus(next);
      if (phone && notify) {
        const [smsRes, waRes] = await Promise.all([
          sendOrderStatusSMS({
            phone,
            name,
            orderId: order.id,
            status: notify,
          }),
          notify === "Pending"
            ? Promise.resolve({ ok: true as const, error: undefined as string | undefined })
            : sendOrderWhatsApp(phone, name, notify),
        ]);
        if (!smsRes.ok || !waRes.ok) {
          showNotice(
            `Status updated. Notify warnings: ${[
              smsRes.ok ? null : `SMS: ${smsRes.error}`,
              waRes.ok ? null : `WA: ${waRes.error}`,
            ]
              .filter(Boolean)
              .join(" · ")}`,
          );
        } else if (notify !== "Pending") {
          showNotice(`SMS + WhatsApp sent to ${name}.`);
        }
      }
    } catch (e) {
      setOrders(prev);
      if (e instanceof AdminFetchError) {
        alert(e.message);
      } else {
        alert("Update failed.");
      }
    } finally {
      setBusyId(null);
    }
  };

  const sendWhatsAppForOrder = async (order: AdminOrderRow) => {
    const phone = order.customers?.phone;
    const name = order.customers?.full_name ?? "Customer";
    const notify = toNotifyStatus(order.status);
    if (!phone) {
      showNotice("Customer has no phone on file.");
      return;
    }
    if (!notify || notify === "Pending") {
      showNotice("No WhatsApp template for this status.");
      return;
    }
    const res = await sendOrderWhatsApp(phone, name, notify);
    showNotice(res.ok ? `WhatsApp sent to ${name}.` : `WhatsApp failed: ${res.error ?? ""}`);
  };

  return (
    <AdminShell
      title="Today's Orders"
      subtitle="Operational queue"
      actions={
        <>
          <Link
            href="/admin/orders/new"
            className="uppercase"
            style={chipPrimary}
          >
            Register new order
          </Link>
          <Link
            href={{
              pathname: "/admin/orders/print",
              query: {
                status: filter,
                q: query,
                sort,
                // Carry the currently-selected date range so the print
                // view shows exactly the same slice as the on-screen table.
                ...(range
                  ? { from: toYMD(range.from), to: toYMD(range.to) }
                  : {}),
              },
            }}
            className="uppercase"
            style={chipPrimary}
          >
            Print orders
          </Link>
          <button
            type="button"
            onClick={() => exportCsv(filtered)}
            className="uppercase"
            style={chipNeutral}
            disabled={filtered.length === 0}
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="uppercase"
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
        <DateRangeDropdown onChange={setRange} />
      </div>

      {/* Status filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {ORDER_FILTER_VALUES.map((v) => {
          const count = counts[v] ?? 0;
          const active = v === filter;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setFilter(v)}
              className="uppercase"
              style={{
                ...chipBase,
                color: active ? "#06120c" : "rgba(245,158,11,0.85)",
                background: active ? "#f59e0b" : "transparent",
                borderColor: active ? "#f59e0b" : "rgba(245,158,11,0.4)",
              }}
            >
              {v.replace(/_/g, " ")}
              <span style={{ marginLeft: 8, opacity: 0.7 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Search + sort */}
      <div className="flex flex-wrap gap-3 items-center mb-6">
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
            minWidth: 240,
          }}
        />
        <div style={{ minWidth: 190 }}>
          <Select
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            ariaLabel="Sort orders"
            options={[
              { value: "created_desc", label: "Newest first" },
              { value: "delivery_asc", label: "Delivery date ↑" },
            ]}
          />
        </div>
      </div>

      {selected.size > 0 ? (
        <BulkToolbar
          count={selected.size}
          running={bulkRunning}
          onClear={() => setSelected(new Set())}
          onAction={(a) => setPendingBulk(a)}
        />
      ) : null}

      {pendingBulk ? (
        <ConfirmModal
          action={pendingBulk}
          count={selected.size}
          running={bulkRunning}
          onCancel={() => setPendingBulk(null)}
          onConfirm={() => void runBulk(pendingBulk)}
        />
      ) : null}

      {bulkResult ? (
        <ResultModal result={bulkResult} onClose={() => setBulkResult(null)} />
      ) : null}

      {notice ? (
        <div
          style={{
            border: "1px solid rgba(245,158,11,0.45)",
            background: "rgba(245,158,11,0.07)",
            color: "#fbf3d4",
            padding: "0.7rem 1rem",
            marginBottom: "1rem",
            fontFamily: "var(--font-body)",
            fontSize: "0.85rem",
            letterSpacing: "0.03em",
          }}
        >
          {notice}
        </div>
      ) : null}

      {editing ? (
        <EditOrderModal
          order={editing}
          onCancel={() => setEditing(null)}
          onSaved={(updated, msg) => {
            setEditing(null);
            setOrders((curr) =>
              curr.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)),
            );
            showNotice(msg);
            void load();
          }}
        />
      ) : null}

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {loading ? (
        <Placeholder>Loading orders…</Placeholder>
      ) : filtered.length === 0 ? (
        <Placeholder>No orders match the current filters.</Placeholder>
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
                <th style={{ ...th, width: 36 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all visible orders"
                    checked={masterChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = !masterChecked && someSelected;
                    }}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th style={th}>Order</th>
                <th style={th}>Customer</th>
                <th style={th}>Address</th>
                <th style={th}>Total</th>
                <th style={th}>Payment</th>
                <th style={th}>Status</th>
                <th style={th}>Delivery</th>
                <th style={th}>Created</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o, i) => {
                const next = nextStatusFor(o);
                const busy = busyId === o.id;
                return (
                  <tr
                    key={o.id}
                    style={{
                      background:
                        i % 2 === 0
                          ? "rgba(245,158,11,0.025)"
                          : "transparent",
                    }}
                  >
                    <td style={td}>
                      <input
                        type="checkbox"
                        aria-label={`Select order ${o.id}`}
                        checked={selected.has(o.id)}
                        onChange={() => toggleSelect(o.id)}
                      />
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          fontFamily: "var(--font-body)",
                          fontSize: "0.7rem",
                          letterSpacing: "0.1em",
                          color: "#fbf3d4",
                        }}
                        title={o.id}
                      >
                        #{o.id.slice(0, 8)}
                      </span>
                    </td>
                    <td style={td}>
                      <div style={{ color: "#fbf3d4", fontSize: "0.85rem" }}>
                        {o.customers?.full_name ?? "—"}
                      </div>
                      {o.customers?.phone ? (
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span
                            style={{
                              color: "rgba(245,158,11,0.85)",
                              fontSize: "0.75rem",
                              letterSpacing: "0.05em",
                            }}
                          >
                            {o.customers.phone}
                          </span>
                          <ContactActions
                            phone={o.customers.phone}
                            customerName={o.customers.full_name}
                            orderInfo={`order #${o.id.slice(0, 8)}`}
                          />
                        </div>
                      ) : null}
                    </td>
                    <td style={{ ...td, maxWidth: 240 }}>
                      {o.fulfillment_type === "pickup" ? (
                        <div
                          className="inline-flex items-center uppercase"
                          style={{
                            fontFamily: "var(--font-body)",
                            fontSize: "0.55rem",
                            letterSpacing: "0.2em",
                            color: "#fcd34d",
                            border: "1px solid rgba(252,211,77,0.5)",
                            padding: "0.15rem 0.5rem",
                            borderRadius: "999px",
                            marginBottom: 4,
                          }}
                        >
                          Pickup
                        </div>
                      ) : null}
                      <div
                        style={{
                          color: "#fbf3d4",
                          fontSize: "0.78rem",
                          lineHeight: 1.4,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {o.delivery_address ?? "—"}
                      </div>
                      {o.fulfillment_type === "pickup" && o.pickup_location ? (
                        <div
                          style={{
                            color: "rgba(252,211,77,0.85)",
                            fontSize: "0.7rem",
                            letterSpacing: "0.03em",
                            marginTop: 2,
                          }}
                        >
                          {o.pickup_location.name}
                          {o.pickup_location.area ? ` · ${o.pickup_location.area}` : ""}
                        </div>
                      ) : o.customers?.city ? (
                        <div
                          style={{
                            color: "rgba(192,200,206,0.65)",
                            fontSize: "0.7rem",
                            letterSpacing: "0.05em",
                            marginTop: 2,
                          }}
                        >
                          {o.customers.city}
                        </div>
                      ) : null}
                      {o.fulfillment_type === "pickup" ? null : (
                        <OrderLocationActions
                          latitude={o.latitude}
                          longitude={o.longitude}
                          orderId={o.id}
                        />
                      )}
                    </td>
                    <td style={td}>
                      <span style={{ color: "#fbf3d4", fontSize: "0.85rem" }}>
                        {formatINR(o.total_amount)}
                      </span>
                    </td>
                    <td style={td}>
                      <PaymentBadge
                        method={o.payment_method}
                        status={o.payment_status}
                      />
                    </td>
                    <td style={td}>
                      <Select
                        value={(o.status ?? "").toLowerCase()}
                        disabled={busy}
                        ariaLabel="Order status"
                        style={statusSelect}
                        onChange={(v) => {
                          const next = v as OrderStatus;
                          if (next === "cancelled") {
                            if (!confirm("Cancel this order?")) return;
                          }
                          void patchStatus(o, next);
                        }}
                        options={[
                          ...ORDER_STATUSES.map((s) => ({ value: s, label: s })),
                          ...(o.status &&
                          !ORDER_STATUSES.includes(o.status as OrderStatus)
                            ? [{ value: o.status, label: o.status }]
                            : []),
                        ]}
                      />
                      <div style={{ marginTop: 4 }}>
                        {/* Show 'expired' badge for stale unpaid pending orders
                            (>7d, per src/lib/order-state.ts). Stored orders.status
                            is still 'pending' — computed_state is derived on read. */}
                        <StatusBadge
                          status={
                            o.computed_state === "expired" ? "expired" : o.status
                          }
                        />
                      </div>
                    </td>
                    <td style={td}>
                      <div style={{ color: "#fbf3d4", fontSize: "0.8rem" }}>
                        {o.delivery_date ? formatDate(o.delivery_date) : "—"}
                      </div>
                      {o.delivery_slot ? (
                        <div
                          style={{
                            color: "rgba(192,200,206,0.65)",
                            fontSize: "0.7rem",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {o.delivery_slot}
                        </div>
                      ) : null}
                    </td>
                    <td style={td}>
                      <span
                        style={{
                          color: "rgba(192,200,206,0.7)",
                          fontSize: "0.75rem",
                        }}
                      >
                        {formatDateTime(o.created_at)}
                      </span>
                    </td>
                    <td style={td}>
                      <div className="flex flex-wrap gap-2">
                        {next ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void advance(o)}
                            style={{
                              ...buttonSm,
                              opacity: busy ? 0.5 : 1,
                            }}
                          >
                            Mark {next}
                          </button>
                        ) : null}
                        {o.customers?.phone &&
                        toNotifyStatus(o.status) &&
                        toNotifyStatus(o.status) !== "Pending" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void sendWhatsAppForOrder(o)}
                            style={{ ...buttonSm, opacity: busy ? 0.5 : 1 }}
                            title={`WhatsApp ${o.customers.full_name ?? ""}`}
                          >
                            Send WA
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setEditing(o)}
                          style={{ ...buttonSm, opacity: busy ? 0.5 : 1 }}
                        >
                          Edit
                        </button>
                        <Link
                          href={`/admin/orders/${o.id}/print`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            ...buttonSm,
                            textDecoration: "none",
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                          title="Print single-order receipt"
                        >
                          Print
                        </Link>
                        {o.status !== "cancelled" && o.status !== "delivered" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (confirm("Cancel this order?")) {
                                void patchStatus(o, "cancelled");
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
    </AdminShell>
  );
}

const ACTION_LABEL: Record<BulkAction, string> = {
  confirm: "Mark confirmed",
  prepare: "Mark preparing",
  dispatch: "Mark out for delivery",
  deliver: "Mark delivered",
  cancel: "Cancel",
};

const ACTION_PAST: Record<BulkAction, string> = {
  confirm: "confirmed",
  prepare: "preparing",
  dispatch: "out_for_delivery",
  deliver: "delivered",
  cancel: "cancelled",
};

function BulkToolbar({
  count,
  running,
  onClear,
  onAction,
}: {
  count: number;
  running: boolean;
  onClear: () => void;
  onAction: (a: BulkAction) => void;
}) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 5,
        display: "flex",
        flexWrap: "wrap",
        gap: "0.6rem",
        alignItems: "center",
        background: "rgba(245,158,11,0.1)",
        border: "1px solid rgba(245,158,11,0.4)",
        padding: "0.6rem 0.9rem",
        marginBottom: "1rem",
      }}
    >
      <span
        style={{
          color: "#fbf3d4",
          fontFamily: "var(--font-body)",
          fontSize: "0.78rem",
          letterSpacing: "0.05em",
        }}
      >
        {count} selected
      </span>
      <span style={{ flex: 1 }} />
      {(Object.keys(ACTION_LABEL) as BulkAction[]).map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => onAction(a)}
          disabled={running}
          style={{
            ...bulkButton,
            color: a === "cancel" ? "#ef4444" : "#f59e0b",
            borderColor:
              a === "cancel"
                ? "rgba(239,68,68,0.45)"
                : "rgba(245,158,11,0.45)",
            opacity: running ? 0.5 : 1,
          }}
        >
          {ACTION_LABEL[a]}
        </button>
      ))}
      <button
        type="button"
        onClick={onClear}
        disabled={running}
        style={{
          ...bulkButton,
          color: "rgba(192,200,206,0.65)",
          borderColor: "rgba(192,200,206,0.3)",
        }}
      >
        Clear
      </button>
    </div>
  );
}

function ConfirmModal({
  action,
  count,
  running,
  onCancel,
  onConfirm,
}: {
  action: BulkAction;
  count: number;
  running: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div style={modalBackdrop} onClick={running ? undefined : onCancel}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h3 style={modalTitle}>
            {ACTION_LABEL[action]} · {count} order{count === 1 ? "" : "s"}?
          </h3>
        </div>
        <div style={modalScrollBody}>
          <p style={modalBody}>
            {action === "cancel"
              ? `This will mark ${count} order${count === 1 ? "" : "s"} as cancelled. The customer will receive a push notification. This cannot be undone via the admin UI.`
              : `${count} order${count === 1 ? "" : "s"} will be marked as ${ACTION_PAST[action]} and the customers notified.`}
          </p>
        </div>
        <div style={modalFooter}>
          <div style={modalActions}>
            <button
              type="button"
              onClick={onCancel}
              disabled={running}
              style={chipNeutral}
            >
              Back
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={running}
              style={{
                ...chipPrimary,
                background: action === "cancel" ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)",
                borderColor:
                  action === "cancel"
                    ? "rgba(239,68,68,0.6)"
                    : "rgba(245,158,11,0.6)",
                color: action === "cancel" ? "#fca5a5" : "#f59e0b",
                opacity: running ? 0.6 : 1,
              }}
            >
              {running ? "Working…" : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultModal({
  result,
  onClose,
}: {
  result: BulkResult;
  onClose: () => void;
}) {
  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h3 style={modalTitle}>Bulk {ACTION_PAST[result.action]} complete</h3>
        </div>
        <div style={modalScrollBody}>
          <p style={{ ...modalBody, marginBottom: "1rem" }}>
            {result.succeeded.length} succeeded · {result.failed.length} failed
          </p>
          {result.failed.length > 0 ? (
            <ul
              style={{
                border: "1px solid rgba(239,68,68,0.35)",
                padding: "0.5rem 0.8rem",
                color: "#fca5a5",
                fontFamily: "var(--font-body)",
                fontSize: "0.78rem",
                listStyle: "none",
                margin: 0,
              }}
            >
              {result.failed.map((f) => (
                <li key={f.id} style={{ padding: "0.2rem 0" }}>
                  #{f.id.slice(0, 8)} — {f.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div style={modalFooter}>
          <div style={modalActions}>
            <button type="button" onClick={onClose} style={chipPrimary}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditOrderModal({
  order,
  onCancel,
  onSaved,
}: {
  order: AdminOrderRow;
  onCancel: () => void;
  onSaved: (updated: AdminOrderRow, message: string) => void;
}) {
  const [fullName, setFullName] = useState(order.customers?.full_name ?? "");
  const [phone, setPhone] = useState(order.customers?.phone ?? "");
  const [city, setCity] = useState(order.customers?.city ?? "");
  const [address, setAddress] = useState(order.delivery_address ?? "");
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const customerId = order.customer_id;
  const canSave =
    !saving &&
    (fullName.trim().length > 0 || phone.trim().length > 0 || address.trim().length > 0);

  const save = async () => {
    setErr(null);
    setSaving(true);
    try {
      const updatedCustomer = {
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
        city: city.trim() || null,
      };
      if (customerId) {
        await adminFetch(`/api/admin/customers/${customerId}`, {
          method: "PATCH",
          body: JSON.stringify(updatedCustomer),
        });
      }
      if (address.trim() && address.trim() !== (order.delivery_address ?? "")) {
        await adminFetch(`/api/admin/orders/${order.id}`, {
          method: "PATCH",
          body: JSON.stringify({ delivery_address: address.trim() }),
        });
      }
      let notifyMessage = "Customer + order updated.";
      if (notify && phone.trim()) {
        // Legacy parity: SMS customer_edit + WhatsApp informational ping.
        const sms = await sendCustomerEditSMS({
          phone: phone.trim(),
          name: fullName.trim() || "Customer",
          address: address.trim(),
        });
        const waBody = `Hi ${fullName.trim() || "Customer"}! Your Cadieux account details have been updated. Name: ${fullName.trim()} · Address: ${address.trim()}. If you did not request this change, please contact us immediately.`;
        let waOk = true;
        let waErr = "";
        try {
          const r = await fetch("/api/send-whatsapp", {
            method: "POST",
            headers: adminAuthHeaders({ "Content-Type": "application/json" }),
            credentials: "include",
            body: JSON.stringify({ phone: phone.trim(), message: waBody }),
          });
          if (!r.ok) {
            const d = (await r.json().catch(() => ({}))) as { error?: string };
            waOk = false;
            waErr = d.error ?? `HTTP ${r.status}`;
          }
        } catch (e) {
          waOk = false;
          waErr = String(e);
        }
        if (sms.ok && waOk) {
          notifyMessage = "Customer + order updated. SMS + WhatsApp sent.";
        } else {
          notifyMessage = `Updated. Notify warnings: ${[
            sms.ok ? null : `SMS: ${sms.error}`,
            waOk ? null : `WA: ${waErr}`,
          ]
            .filter(Boolean)
            .join(" · ")}`;
        }
      }
      onSaved(
        {
          ...order,
          delivery_address: address.trim() || order.delivery_address,
          customers: {
            id: customerId ?? "",
            full_name: updatedCustomer.full_name,
            phone: updatedCustomer.phone,
            city: updatedCustomer.city,
          },
        },
        notifyMessage,
      );
    } catch (e) {
      if (e instanceof AdminFetchError) setErr(e.message);
      else setErr("Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={modalBackdrop} onClick={saving ? undefined : onCancel}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h3 style={modalTitle}>Edit customer · order #{order.id.slice(0, 8)}</h3>
        </div>
        <div style={modalScrollBody}>
          <Field label="Full name">
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={saving}
              style={modalInput}
            />
          </Field>
          <Field label="Phone">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={saving}
              style={modalInput}
            />
          </Field>
          <Field label="City">
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              disabled={saving}
              style={modalInput}
            />
          </Field>
          <Field label="Delivery address">
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={saving}
              rows={4}
              style={{
                ...modalInput,
                fontFamily: "var(--font-body)",
                resize: "vertical",
              }}
            />
          </Field>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              margin: "0.5rem 0 1rem",
              color: "rgba(192,200,206,0.8)",
              fontFamily: "var(--font-body)",
              fontSize: "0.78rem",
            }}
          >
            <input
              type="checkbox"
              checked={notify}
              disabled={saving}
              onChange={(e) => setNotify(e.target.checked)}
            />
            Send SMS + WhatsApp to customer about this change
          </label>
          {err ? (
            <p style={{ color: "#fca5a5", fontSize: "0.8rem", margin: 0 }}>
              {err}
            </p>
          ) : null}
        </div>
        <div style={modalFooter}>
          <div style={modalActions}>
            <button type="button" onClick={onCancel} disabled={saving} style={chipNeutral}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave}
              style={{
                ...chipPrimary,
                opacity: !canSave ? 0.5 : 1,
              }}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.3rem",
        margin: "0 0 0.8rem",
        fontFamily: "var(--font-body)",
        fontSize: "0.68rem",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "rgba(245,158,11,0.85)",
      }}
    >
      {label}
      {children}
    </label>
  );
}

const modalInput: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(245,158,11,0.3)",
  color: "#fbf3d4",
  padding: "0.55rem 0.7rem",
  fontSize: "0.85rem",
  letterSpacing: "0.02em",
  outline: "none",
  textTransform: "none",
};

function exportCsv(rows: AdminOrderRow[]): void {
  const csv = toCsv(rows, [
    { header: "Order ID", value: (o) => o.id },
    { header: "Customer", value: (o) => o.customers?.full_name ?? "" },
    { header: "Phone", value: (o) => o.customers?.phone ?? "" },
    { header: "Total", value: (o) => o.total_amount ?? 0 },
    { header: "Status", value: (o) => o.status ?? "" },
    { header: "Delivery date", value: (o) => o.delivery_date ?? "" },
    { header: "Delivery slot", value: (o) => o.delivery_slot ?? "" },
    { header: "Delivery address", value: (o) => o.delivery_address ?? "" },
    { header: "Created", value: (o) => o.created_at },
  ]);
  downloadCsv(csvFilename("orders"), csv);
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
        letterSpacing: "0.05em",
      }}
    >
      {children}
    </div>
  );
}

// Payment status pill for the orders table. Paid = green, COD = grey,
// Failed = red, anything else (razorpay created/pending) = amber.
function PaymentBadge({
  method,
  status,
}: {
  method?: string | null;
  status?: string | null;
}) {
  const m = (method ?? "").toLowerCase();
  const s = (status ?? "").toLowerCase();

  let label: string;
  let color: string;
  let bg: string;
  if (s === "paid") {
    label = "Paid";
    color = "rgb(74,222,128)";
    bg = "rgba(74,222,128,0.12)";
  } else if (s === "failed") {
    label = "Failed";
    color = "#ff8181";
    bg = "rgba(255,129,129,0.12)";
  } else if (m === "cod") {
    label = "COD";
    color = "rgba(192,200,206,0.85)";
    bg = "rgba(192,200,206,0.1)";
  } else if (!m && !s) {
    label = "—";
    color = "rgba(192,200,206,0.5)";
    bg = "transparent";
  } else {
    label = "Awaiting";
    color = "rgb(245,158,11)";
    bg = "rgba(245,158,11,0.12)";
  }

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        background: bg,
        color,
        fontFamily: "var(--font-body)",
        fontSize: "0.7rem",
        fontWeight: 500,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid rgba(239,68,68,0.45)",
        background: "rgba(239,68,68,0.06)",
        padding: "0.8rem 1rem",
        marginBottom: "1rem",
        color: "#fca5a5",
        fontFamily: "var(--font-body)",
        fontSize: "0.85rem",
        display: "flex",
        gap: "1rem",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <span>{message}</span>
      <button type="button" onClick={onRetry} style={buttonSm}>
        Retry
      </button>
    </div>
  );
}

const statusSelect: React.CSSProperties = {
  padding: "0.3rem 0.5rem",
  background: "transparent",
  border: "1px solid rgba(245,158,11,0.45)",
  color: "#fbf3d4",
  fontFamily: "var(--font-body)",
  fontSize: "0.72rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  cursor: "pointer",
  maxWidth: 140,
  minHeight: 0,
  borderRadius: 6,
};

const chipBase: React.CSSProperties = {
  padding: "0.35rem 0.85rem",
  border: "1px solid rgba(245,158,11,0.4)",
  fontFamily: "var(--font-body)",
  fontSize: "0.65rem",
  letterSpacing: "0.22em",
  background: "transparent",
  cursor: "pointer",
};

const chipPrimary: React.CSSProperties = {
  ...chipBase,
  color: "#f59e0b",
  borderColor: "rgba(245,158,11,0.55)",
  display: "inline-block",
  textDecoration: "none",
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

const bulkButton: React.CSSProperties = {
  padding: "0.4rem 0.85rem",
  background: "transparent",
  border: "1px solid rgba(245,158,11,0.45)",
  fontFamily: "var(--font-body)",
  fontSize: "0.65rem",
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  cursor: "pointer",
};

const modalBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(29,29,31,0.78)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
  padding: "1rem",
};

const modalCard: React.CSSProperties = {
  width: "100%",
  maxWidth: 460,
  background: "rgb(12,8,4)",
  border: "1px solid rgba(245,158,11,0.4)",
  borderRadius: 6,
  // 3-zone scrollable layout: sticky header + scrollable body + sticky footer
  display: "flex",
  flexDirection: "column",
  maxHeight: "min(90vh, calc(100dvh - 2rem))",
  minHeight: 0,
  overflow: "hidden",
};

const modalHeader: React.CSSProperties = {
  flexShrink: 0,
  padding: "1.1rem 1.4rem 0.9rem",
  background: "rgb(12,8,4)",
  borderBottom: "1px solid rgba(245,158,11,0.18)",
};

const modalScrollBody: React.CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  padding: "1.1rem 1.4rem",
};

const modalFooter: React.CSSProperties = {
  flexShrink: 0,
  padding: "0.9rem 1.4rem",
  background: "rgb(12,8,4)",
  borderTop: "1px solid rgba(245,158,11,0.18)",
};

const modalTitle: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontSize: "1.05rem",
  color: "#fbf3d4",
  margin: 0,
  letterSpacing: "0.04em",
};

const modalBody: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.85rem",
  color: "rgba(192,200,206,0.85)",
  lineHeight: 1.5,
  margin: 0,
};

const modalActions: React.CSSProperties = {
  display: "flex",
  gap: "0.6rem",
  justifyContent: "flex-end",
};
