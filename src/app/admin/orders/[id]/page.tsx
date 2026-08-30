"use client";

// Read-only single-order detail page for /admin/orders.
//
// Reached by clicking any row in the orders list. Laid out like a printed
// invoice: every stored field for the order is visible in one view, grouped
// into labelled blocks (header / customer / fulfillment / items / payment /
// timeline) so the operator never has to expand or hunt.
//
// Data comes from the admin-gated GET /api/admin/orders/[id] — the same
// endpoint the print receipt uses — so nothing here is exposed
// unauthenticated. This page NEVER writes: no status changes, no edits.
// All mutations still live on the list page and its modals.
//
// Styling reuses the existing admin palette (gold hairlines on near-black,
// cream text) — see /admin/customers/[id] for the same Card/KeyVal idiom.
// The print stylesheet at the bottom flips the block to black-on-white and
// drops the admin chrome, since the dark theme would print as a solid slab.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { adminFetch, AdminFetchError } from "@/lib/admin-client";
import { formatDate, formatDateTime, formatINR } from "@/lib/admin-formatting";
import type {
  AdminOrderItemSnapshot,
  AdminOrderRow,
} from "@/lib/admin-shared";
import { formatSlotForDisplay } from "@/lib/delivery-slots";
import { formatOrderNumber } from "@/lib/order-number";

type OrderResponse = { order: AdminOrderRow };

const DASH = "—";

/** Every field on this page renders through here, so a null column can
 *  never surface as an empty cell or the literal string "null". */
function show(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  const s = String(v).trim();
  return s === "" ? DASH : s;
}

/** "out_for_delivery" → "Out for delivery". */
function humanise(v: string | null | undefined): string {
  if (!v) return DASH;
  const s = v.replace(/_/g, " ").trim();
  if (!s) return DASH;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Item accessors mirror the print receipt — the items jsonb was written by
// four different checkout paths over time, so both key spellings exist.
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

export default function AdminOrderDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [order, setOrder] = useState<AdminOrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch<OrderResponse>(
        `/api/admin/orders/${encodeURIComponent(params.id)}`,
      );
      setOrder(res.order ?? null);
    } catch (e) {
      if (e instanceof AdminFetchError && e.status === 404) {
        setMissing(true);
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

  const items = useMemo(
    () => (order && Array.isArray(order.items) ? order.items : []),
    [order],
  );

  const deliveryFee =
    typeof order?.delivery_fee === "number" ? order.delivery_fee : null;

  // Prefer summing the item line totals so the fee line is meaningful;
  // fall back to (total − fee) for rows whose items carry no prices.
  const subtotal = useMemo(() => {
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

  const backLink = (
    <Link href="/admin/orders" style={chipNeutral} className="no-print">
      ← Back to orders
    </Link>
  );

  if (loading) {
    return (
      <AdminShell title="Order" actions={backLink}>
        <Placeholder>Loading order…</Placeholder>
      </AdminShell>
    );
  }

  if (missing) {
    return (
      <AdminShell title="Order not found" actions={backLink}>
        <Placeholder>
          No order matches this id. It may have been deleted, or the link is
          stale.
        </Placeholder>
      </AdminShell>
    );
  }

  if (error || !order) {
    return (
      <AdminShell title="Order" actions={backLink}>
        <Placeholder>
          Could not load order: {error ?? "unknown error"}
        </Placeholder>
      </AdminShell>
    );
  }

  const isPickup = order.fulfillment_type === "pickup";
  const slot = order.delivery_slot
    ? formatSlotForDisplay(order.delivery_slot)
    : null;
  const hasCoords =
    typeof order.latitude === "number" && typeof order.longitude === "number";
  const hasRefund = Boolean(
    order.refund_status || order.refund_id || order.refunded_at,
  );

  // Chronological — nulls are dropped so the block never shows dead rows.
  const timeline: { label: string; at: string | null | undefined }[] = [
    { label: "Order placed", at: order.created_at },
    { label: "Payment captured", at: order.paid_at },
    { label: "Delivery date scheduled", at: order.scheduled_delivery_date_at },
    { label: "Pickup ready", at: order.pickup_ready_at },
    { label: "Picked up", at: order.picked_up_at },
    { label: "Status last updated", at: order.status_updated_at },
    { label: "Refunded", at: order.refunded_at },
    { label: "Cancelled", at: order.cancelled_at },
  ]
    .filter((e) => Boolean(e.at))
    .sort(
      (a, b) => new Date(a.at as string).getTime() - new Date(b.at as string).getTime(),
    );

  return (
    <AdminShell
      // The order number lives in the HEADER block below (large, next to the
      // badges) — keeping the shell title generic avoids printing it twice.
      title="Order"
      actions={
        <>
          <button
            type="button"
            onClick={() => window.print()}
            style={chipPrimary}
            className="no-print"
          >
            Print
          </button>
          {backLink}
        </>
      }
    >
      <div id="order-detail" style={{ display: "grid", gap: "1.25rem" }}>
        {/* 1 · HEADER ------------------------------------------------- */}
        <section style={panel}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={orderNumber}>{formatOrderNumber(order)}</div>
              <div style={mutedLine}>
                Placed {formatDateTime(order.created_at)}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.5rem",
                alignItems: "center",
              }}
            >
              <StatusBadge status={order.status ?? undefined} />
              <StatusBadge status={order.payment_status ?? undefined} />
              {order.is_preorder ? <span style={preorderChip}>Pre-order</span> : null}
            </div>
          </div>
        </section>

        {/* 2 · CUSTOMER ----------------------------------------------- */}
        <Block title="Customer">
          <KeyVal k="Name" v={show(order.customers?.full_name)} />
          <KeyVal k="Phone" v={show(order.customers?.phone)} />
          <KeyVal k="Email" v={show(order.customers?.email)} />
          <KeyVal k="City" v={show(order.customers?.city)} />
        </Block>

        {/* 3 · FULFILLMENT -------------------------------------------- */}
        <Block title={isPickup ? "Fulfillment — Pickup" : "Fulfillment — Delivery"}>
          {isPickup ? (
            <>
              <KeyVal k="Pickup location" v={show(order.pickup_location?.name)} />
              <KeyVal k="Area" v={show(order.pickup_location?.area)} />
              <KeyVal k="Address" v={show(order.pickup_location?.address)} />
              <KeyVal k="Pickup date" v={formatDate(order.delivery_date)} />
              <KeyVal k="Pickup slot" v={show(slot)} />
              <KeyVal k="Ready at" v={formatDateTime(order.pickup_ready_at)} />
              <KeyVal k="Picked up at" v={formatDateTime(order.picked_up_at)} />
            </>
          ) : (
            <>
              <KeyVal k="Delivery address" v={show(order.delivery_address)} />
              <KeyVal k="Delivery date" v={formatDate(order.delivery_date)} />
              <KeyVal k="Delivery slot" v={show(slot)} />
              <KeyVal
                k="Distance"
                v={
                  typeof order.distance_km === "number"
                    ? `${order.distance_km.toFixed(1)} km`
                    : DASH
                }
              />
              <KeyVal
                k="Coordinates"
                v={
                  hasCoords ? `${order.latitude}, ${order.longitude}` : DASH
                }
              />
              <div style={rowWrap}>
                <span style={keyStyle}>Map</span>
                <span style={valStyle}>
                  {hasCoords ? (
                    <a
                      href={`https://www.google.com/maps?q=${order.latitude},${order.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={mapsLink}
                    >
                      Open in Google Maps ↗
                    </a>
                  ) : (
                    DASH
                  )}
                </span>
              </div>
            </>
          )}
        </Block>

        {/* 4 · ITEMS --------------------------------------------------- */}
        <section style={panel}>
          <h3 style={blockHeading}>Items</h3>
          <div style={tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={tableHeadRow}>
                  <th style={th}>Product</th>
                  <th style={{ ...th, width: 80, textAlign: "right" }}>Qty</th>
                  <th style={{ ...th, width: 120, textAlign: "right" }}>
                    Unit price
                  </th>
                  <th style={{ ...th, width: 130, textAlign: "right" }}>
                    Line total
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td style={td} colSpan={4}>
                      No item details recorded.
                    </td>
                  </tr>
                ) : (
                  items.map((it, i) => {
                    const unit = itemUnitPrice(it);
                    const line = itemLineTotal(it);
                    return (
                      <tr key={`${it.slug ?? it.product_id ?? "item"}-${i}`}>
                        <td style={td}>{show(it.name)}</td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {itemQty(it)}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {unit === null ? DASH : formatINR(unit)}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {line === null ? DASH : formatINR(line)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div style={totalsBlock}>
            <div style={totalsRow}>
              <span>Subtotal</span>
              <span>{subtotal === null ? DASH : formatINR(subtotal)}</span>
            </div>
            <div style={totalsRow}>
              <span>{isPickup ? "Pickup fee" : "Delivery fee"}</span>
              <span>
                {deliveryFee === null
                  ? DASH
                  : deliveryFee === 0
                    ? "Free"
                    : formatINR(deliveryFee)}
              </span>
            </div>
            <div style={{ ...totalsRow, ...totalsGrand }}>
              <span>Total</span>
              <span>{formatINR(order.total_amount)}</span>
            </div>
          </div>
        </section>

        {/* 5 · PAYMENT ------------------------------------------------- */}
        <Block title="Payment">
          <KeyVal
            k="Method"
            v={
              order.payment_method === "cod"
                ? "COD"
                : humanise(order.payment_method)
            }
          />
          <KeyVal k="Status" v={humanise(order.payment_status)} />
          <KeyVal k="Razorpay order id" v={show(order.razorpay_order_id)} />
          <KeyVal k="Razorpay payment id" v={show(order.razorpay_payment_id)} />
          <KeyVal k="Paid at" v={formatDateTime(order.paid_at)} />
          {hasRefund ? (
            <>
              <KeyVal k="Refund status" v={humanise(order.refund_status)} />
              <KeyVal k="Refund id" v={show(order.refund_id)} />
              <KeyVal k="Refunded at" v={formatDateTime(order.refunded_at)} />
            </>
          ) : null}
        </Block>

        {/* 6 · TIMELINE ------------------------------------------------ */}
        <Block title="Timeline">
          {timeline.length === 0 ? (
            <div style={mutedLine}>No timestamps recorded.</div>
          ) : (
            timeline.map((e) => (
              <KeyVal
                key={e.label}
                k={e.label}
                v={formatDateTime(e.at ?? null)}
              />
            ))
          )}
          {order.cancelled_at ? (
            <KeyVal
              k="Cancellation reason"
              v={show(order.cancellation_reason)}
            />
          ) : null}
        </Block>
      </div>

      {/* Print stylesheet — drop the admin chrome and flip the dark theme
          to black-on-white so the invoice is legible on paper. Screen
          styling above is untouched. */}
      <style jsx global>{`
        @media print {
          @page {
            margin: 12mm;
          }
          .no-print,
          header,
          aside,
          [aria-hidden="true"],
          body > button,
          body > audio {
            display: none !important;
          }
          html,
          body,
          main {
            background: #fff !important;
          }
          main > div > section {
            padding: 0 !important;
          }
          main,
          main * {
            color: #000 !important;
            background: transparent !important;
            box-shadow: none !important;
          }
          #order-detail section,
          #order-detail table,
          #order-detail th,
          #order-detail td,
          #order-detail [data-panel] {
            border-color: #999 !important;
          }
        }
      `}</style>
    </AdminShell>
  );
}

// ── local presentational pieces ───────────────────────────────────────────

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={panel} data-panel>
      <h3 style={blockHeading}>{title}</h3>
      <div style={{ display: "grid", gap: "0.55rem" }}>{children}</div>
    </section>
  );
}

function KeyVal({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={rowWrap}>
      <span style={keyStyle}>{k}</span>
      <span style={valStyle}>{v}</span>
    </div>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px dashed rgba(245,158,11,0.2)",
        borderRadius: 6,
        padding: "2rem 1rem",
        textAlign: "center",
        fontFamily: "var(--font-body)",
        fontSize: "0.85rem",
        color: "rgba(192,200,206,0.55)",
      }}
    >
      {children}
    </div>
  );
}

// ── styles (existing admin palette — nothing new invented) ────────────────

const panel: React.CSSProperties = {
  border: "1px solid rgba(245,158,11,0.18)",
  borderRadius: 6,
  padding: "1rem 1.1rem",
};

const blockHeading: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.62rem",
  letterSpacing: "0.25em",
  textTransform: "uppercase",
  color: "rgba(245,158,11,0.9)",
  margin: "0 0 0.85rem",
};

const orderNumber: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontWeight: 300,
  fontSize: "clamp(1.6rem, 5vw, 2.2rem)",
  letterSpacing: "0.14em",
  color: "#fbf3d4",
  lineHeight: 1.1,
};

const mutedLine: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.78rem",
  color: "rgba(192,200,206,0.55)",
  marginTop: "0.3rem",
};

const rowWrap: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "1.5rem",
  fontFamily: "var(--font-body)",
  fontSize: "0.82rem",
};

const keyStyle: React.CSSProperties = {
  color: "rgba(192,200,206,0.55)",
  whiteSpace: "nowrap",
};

const valStyle: React.CSSProperties = {
  color: "#fbf3d4",
  textAlign: "right",
  wordBreak: "break-word",
  minWidth: 0,
};

const tableWrap: React.CSSProperties = {
  border: "1px solid rgba(245,158,11,0.18)",
  borderRadius: 6,
  overflow: "hidden",
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

const totalsBlock: React.CSSProperties = {
  marginTop: "1rem",
  marginLeft: "auto",
  width: "min(340px, 100%)",
  display: "flex",
  flexDirection: "column",
  gap: "0.3rem",
};

const totalsRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontFamily: "var(--font-body)",
  fontSize: "0.85rem",
  color: "#fbf3d4",
  padding: "0.15rem 0",
};

const totalsGrand: React.CSSProperties = {
  borderTop: "1px solid rgba(245,158,11,0.35)",
  marginTop: "0.35rem",
  paddingTop: "0.5rem",
  fontSize: "1rem",
  color: "#f59e0b",
};

const chipBase: React.CSSProperties = {
  padding: "0.35rem 0.85rem",
  border: "1px solid rgba(245,158,11,0.4)",
  fontFamily: "var(--font-body)",
  fontSize: "0.65rem",
  letterSpacing: "0.22em",
  background: "transparent",
  cursor: "pointer",
  textTransform: "uppercase",
  textDecoration: "none",
  display: "inline-block",
};

const chipPrimary: React.CSSProperties = {
  ...chipBase,
  color: "#f59e0b",
  borderColor: "rgba(245,158,11,0.55)",
};

const chipNeutral: React.CSSProperties = {
  ...chipBase,
  color: "rgba(245,158,11,0.85)",
};

const preorderChip: React.CSSProperties = {
  ...chipBase,
  cursor: "default",
  fontSize: "0.6rem",
  padding: "0.3rem 0.7rem",
  color: "#f59e0b",
};

const mapsLink: React.CSSProperties = {
  color: "#f59e0b",
  textDecoration: "underline",
  textUnderlineOffset: "2px",
};
