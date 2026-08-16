"use client";

// Single-order printable receipt / invoice for /admin/orders.
//
// Fetches ONE order via the admin-gated GET /api/admin/orders/[id]
// (same auth as everything else in /admin — adminFetch attaches the
// bearer token, the API returns 401 otherwise, so nothing here is
// exposed unauthenticated).
//
// Layout mirrors the packing-list print page: clean b/w typography,
// inline @media print CSS to hide the on-screen "Print again" button,
// window.print() fires automatically after a short paint delay so the
// browser's own dialog handles printer + A4/A3 selection.

import { useCallback, useEffect, useMemo, useState } from "react";

import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import {
  formatDate,
  formatDateTime,
  formatINR,
} from "@/lib/admin-formatting";
import { formatSlotForDisplay } from "@/lib/delivery-slots";
import type {
  AdminOrderItemSnapshot,
  AdminOrderRow,
} from "@/lib/admin-shared";
import { formatOrderNumber } from "@/lib/order-number";

type OrderResponse = { order: AdminOrderRow };

function itemQty(item: AdminOrderItemSnapshot): number {
  return item.qty ?? item.quantity ?? 1;
}

function itemUnitPrice(item: AdminOrderItemSnapshot): number | null {
  const p = item.unit_price_inr ?? item.price_inr;
  return typeof p === "number" && Number.isFinite(p) ? p : null;
}

function itemLineTotal(item: AdminOrderItemSnapshot): number | null {
  const t = item.line_total_inr ?? item.line_total;
  if (typeof t === "number" && Number.isFinite(t)) return t;
  const unit = itemUnitPrice(item);
  if (unit === null) return null;
  return unit * itemQty(item);
}

function formatOrderId(order: AdminOrderRow): string {
  // Prefers the DB-trigger-assigned OLF number; falls back to the
  // UUID hex slice on legacy pre-trigger rows. See src/lib/order-number.ts.
  return formatOrderNumber(order);
}

function formatPaymentLabel(order: AdminOrderRow): string {
  const method =
    order.payment_method === "cod"
      ? "COD"
      : order.payment_method
        ? order.payment_method.charAt(0).toUpperCase() +
          order.payment_method.slice(1)
        : "—";
  const status = order.payment_status
    ? order.payment_status.charAt(0).toUpperCase() +
      order.payment_status.slice(1).replace(/_/g, " ")
    : "—";
  return `${method} · ${status}`;
}

export default function PrintOrderReceiptPage({
  params,
}: {
  params: { id: string };
}) {
  const [order, setOrder] = useState<AdminOrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch<OrderResponse>(
        `/api/admin/orders/${encodeURIComponent(params.id)}`,
      );
      setOrder(res.order ?? null);
    } catch (e) {
      if (e instanceof AdminFetchError) {
        if (e.status === 404) {
          setNotFound(true);
        } else {
          setError(e.message);
        }
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("Could not load order.");
      }
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-open the browser print dialog once the receipt has painted.
  // Same 250 ms cushion as the packing-list route.
  useEffect(() => {
    if (!loading && order) {
      const t = setTimeout(() => window.print(), 250);
      return () => clearTimeout(t);
    }
  }, [loading, order]);

  const items = useMemo(
    () => (order && Array.isArray(order.items) ? order.items : []),
    [order],
  );

  const isPickup = order?.fulfillment_type === "pickup";
  const deliveryFee =
    typeof order?.delivery_fee === "number" ? order.delivery_fee : null;
  // Derive subtotal from item line totals so the fee line is meaningful.
  // Falls back to (total − fee) when items don't carry a price.
  const itemsSubtotal = useMemo(() => {
    let sum = 0;
    let sawAny = false;
    for (const it of items) {
      const t = itemLineTotal(it);
      if (t !== null) {
        sum += t;
        sawAny = true;
      }
    }
    if (sawAny) return sum;
    if (
      order &&
      typeof order.total_amount === "number" &&
      deliveryFee !== null
    ) {
      return Math.max(order.total_amount - deliveryFee, 0);
    }
    return null;
  }, [items, order, deliveryFee]);

  if (loading) {
    return (
      <main style={page}>
        <p>Loading order…</p>
      </main>
    );
  }
  if (notFound) {
    return (
      <main style={page}>
        <h1 style={{ fontSize: "1.2rem", margin: 0 }}>Order not found</h1>
        <p style={{ marginTop: "0.6rem", color: "#444" }}>
          No order matches this id. It may have been deleted or the link is
          stale.
        </p>
      </main>
    );
  }
  if (error || !order) {
    return (
      <main style={page}>
        <p style={{ color: "#b91c1c" }}>
          Could not load order: {error ?? "unknown error"}
        </p>
      </main>
    );
  }

  const slot = order.delivery_slot
    ? formatSlotForDisplay(order.delivery_slot)
    : "";

  return (
    <main style={page}>
      {/* Brand header */}
      <header style={brandHeader}>
        <div>
          <div style={brandName}>CADIEUX</div>
          <div style={brandTagline}>Fresh protein bread · Visakhapatnam</div>
        </div>
        <div style={docType}>Order Receipt</div>
      </header>

      {/* Meta grid: order id, dates, payment */}
      <section style={metaGrid}>
        <div>
          <div style={metaLabel}>Order</div>
          <div style={metaValue}>{formatOrderId(order)}</div>
        </div>
        <div>
          <div style={metaLabel}>Placed</div>
          <div style={metaValue}>{formatDateTime(order.created_at)}</div>
        </div>
        <div>
          <div style={metaLabel}>Payment</div>
          <div style={metaValue}>{formatPaymentLabel(order)}</div>
        </div>
        <div>
          <div style={metaLabel}>Status</div>
          <div style={metaValue}>{order.status ?? "—"}</div>
        </div>
      </section>

      {/* Customer + fulfilment */}
      <section style={twoCol}>
        <div style={colBox}>
          <div style={sectionHeading}>Customer</div>
          <div style={detailValue}>{order.customers?.full_name ?? "—"}</div>
          <div style={detailMuted}>{order.customers?.phone ?? "—"}</div>
          {order.customers?.city ? (
            <div style={detailMuted}>{order.customers.city}</div>
          ) : null}
        </div>
        <div style={colBox}>
          <div style={sectionHeading}>
            {isPickup ? "Pickup" : "Delivery"}
          </div>
          {isPickup ? (
            <>
              <div style={detailValue}>
                {order.pickup_location?.name ?? "Cadieux stall"}
              </div>
              {order.pickup_location?.area ? (
                <div style={detailMuted}>{order.pickup_location.area}</div>
              ) : null}
              {order.pickup_location?.address ? (
                <div style={detailMuted}>{order.pickup_location.address}</div>
              ) : null}
              <div style={{ ...detailValue, marginTop: "0.35rem" }}>
                {order.delivery_date ? formatDate(order.delivery_date) : "—"}
                {slot ? ` · ${slot}` : ""}
              </div>
            </>
          ) : (
            <>
              <div style={detailValue}>{order.delivery_address ?? "—"}</div>
              <div style={{ ...detailValue, marginTop: "0.35rem" }}>
                {order.delivery_date ? formatDate(order.delivery_date) : "—"}
                {slot ? ` · ${slot}` : ""}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Items table */}
      <section style={{ marginTop: "1.1rem" }}>
        <div style={sectionHeading}>Items</div>
        <table style={itemsTable}>
          <thead>
            <tr>
              <th style={{ ...itemsTh, width: "8%" }}>Qty</th>
              <th style={itemsTh}>Item</th>
              <th style={{ ...itemsTh, width: "18%", textAlign: "right" }}>
                Unit
              </th>
              <th style={{ ...itemsTh, width: "18%", textAlign: "right" }}>
                Line total
              </th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td style={itemsTd} colSpan={4}>
                  No item details recorded.
                </td>
              </tr>
            ) : (
              items.map((it, i) => {
                const unit = itemUnitPrice(it);
                const line = itemLineTotal(it);
                return (
                  <tr key={`${it.slug ?? it.product_id ?? "item"}-${i}`}>
                    <td style={itemsTd}>{itemQty(it)}</td>
                    <td style={itemsTd}>{it.name}</td>
                    <td style={{ ...itemsTd, textAlign: "right" }}>
                      {unit === null ? "—" : formatINR(unit)}
                    </td>
                    <td style={{ ...itemsTd, textAlign: "right" }}>
                      {line === null ? "—" : formatINR(line)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      {/* Totals */}
      <section style={totalsBlock}>
        {itemsSubtotal !== null ? (
          <div style={totalsRow}>
            <span>Subtotal</span>
            <span>{formatINR(itemsSubtotal)}</span>
          </div>
        ) : null}
        <div style={totalsRow}>
          <span>{isPickup ? "Pickup fee" : "Delivery fee"}</span>
          <span>
            {isPickup
              ? "Free"
              : deliveryFee === null
                ? "—"
                : deliveryFee === 0
                  ? "Free"
                  : formatINR(deliveryFee)}
          </span>
        </div>
        <div style={{ ...totalsRow, ...totalsRowGrand }}>
          <span>Total</span>
          <span>{formatINR(order.total_amount)}</span>
        </div>
      </section>

      <footer style={footer}>
        Thank you for choosing Cadieux · cadieux.in
      </footer>

      {/* On-screen only — hidden in print via @media print below. */}
      <div className="no-print" style={{ marginTop: "1.5rem" }}>
        <button type="button" onClick={() => window.print()} style={printBtn}>
          Print again
        </button>
      </div>

      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }
          @page {
            margin: 14mm;
          }
        }
      `}</style>
    </main>
  );
}

// ── styles ────────────────────────────────────────────────────────────────
// Deliberately paper-size-agnostic — no fixed widths that would break on
// A4/A3/Letter. Percentages + max-width let the browser dialog do its job.

const page: React.CSSProperties = {
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  color: "#000",
  background: "#fff",
  padding: "1.5rem",
  maxWidth: "820px",
  margin: "0 auto",
};

const brandHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "1rem",
  borderBottom: "2px solid #000",
  paddingBottom: "0.75rem",
  marginBottom: "1rem",
};

const brandName: React.CSSProperties = {
  fontSize: "1.6rem",
  fontWeight: 700,
  letterSpacing: "0.14em",
};

const brandTagline: React.CSSProperties = {
  marginTop: "0.15rem",
  color: "#444",
  fontSize: "0.8rem",
  letterSpacing: "0.03em",
};

const docType: React.CSSProperties = {
  fontSize: "0.95rem",
  fontWeight: 600,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  border: "1px solid #000",
  padding: "0.3rem 0.7rem",
};

const metaGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: "0.6rem 1rem",
  marginBottom: "1rem",
};

const metaLabel: React.CSSProperties = {
  fontSize: "0.65rem",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "#555",
  marginBottom: "0.15rem",
};

const metaValue: React.CSSProperties = {
  fontSize: "0.9rem",
  fontWeight: 500,
  color: "#000",
};

const twoCol: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "1rem",
};

const colBox: React.CSSProperties = {
  border: "1px solid #ccc",
  padding: "0.7rem 0.85rem",
  borderRadius: 4,
};

const sectionHeading: React.CSSProperties = {
  fontSize: "0.7rem",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "#555",
  marginBottom: "0.35rem",
};

const detailValue: React.CSSProperties = {
  fontSize: "0.9rem",
  color: "#000",
  lineHeight: 1.35,
};

const detailMuted: React.CSSProperties = {
  fontSize: "0.8rem",
  color: "#444",
  lineHeight: 1.35,
};

const itemsTable: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: "0.4rem",
};

const itemsTh: React.CSSProperties = {
  border: "1px solid #ccc",
  padding: "6px 8px",
  textAlign: "left",
  fontSize: "0.75rem",
  background: "#f3f3f3",
};

const itemsTd: React.CSSProperties = {
  border: "1px solid #ccc",
  padding: "6px 8px",
  fontSize: "0.85rem",
  verticalAlign: "top",
};

const totalsBlock: React.CSSProperties = {
  marginTop: "0.9rem",
  marginLeft: "auto",
  width: "min(320px, 100%)",
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
};

const totalsRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: "0.85rem",
  padding: "0.15rem 0",
};

const totalsRowGrand: React.CSSProperties = {
  borderTop: "2px solid #000",
  marginTop: "0.35rem",
  paddingTop: "0.4rem",
  fontSize: "1rem",
  fontWeight: 700,
};

const footer: React.CSSProperties = {
  marginTop: "1.5rem",
  paddingTop: "0.5rem",
  borderTop: "1px solid #ccc",
  fontSize: "0.75rem",
  color: "#555",
  textAlign: "center",
  letterSpacing: "0.05em",
};

const printBtn: React.CSSProperties = {
  background: "#024628",
  color: "#fbf3d4",
  border: "1px solid #024628",
  borderRadius: 4,
  padding: "0.4rem 0.9rem",
  fontSize: "0.85rem",
  cursor: "pointer",
  letterSpacing: "0.05em",
};
