"use client";

// Per-order detail page. Linked from the checkout success screen and
// (eventually) from the /orders list. The user must already have a
// valid cdx_phone_verified cookie matching the order's customer phone,
// otherwise /api/orders/[id] returns 404 and we render an "unavailable"
// state with a path back to /orders (which prompts re-verification).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { ShareButton } from "@/components/ShareButton";
import {
  ORDER_STAGES,
  STAGE_LABEL,
  isCancelled,
  stageIndex,
  toStage,
} from "@/lib/order-stages";
import {
  bookableSlots,
  dateLabel,
  formatSlotForDisplay,
  nextDeliveryDates,
} from "@/lib/delivery-slots";
import { trackPurchase } from "@/lib/analytics";

const GRAIN = "url(/grain.svg)";

type OrderItem = {
  slug?: string;
  name: string;
  qty: number;
  kind?: "once" | "sub";
  price_inr?: number;
  line_total?: number;
};

type Order = {
  id: string;
  total_amount: number;
  delivery_fee: number | null;
  status: string;
  status_updated_at?: string | null;
  delivery_address: string | null;
  items: OrderItem[] | null;
  delivery_date: string | null;
  delivery_slot: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  refund_status: string | null;
  payment_method: string | null;
  payment_status: string | null;
};

type ChangeRequest = {
  id: string;
  status: string;
  type?: string | null;
  requested_delivery_date: string | null;
  requested_delivery_slot: string | null;
  requested_delivery_address: string | null;
  requested_items: { slug: string; qty: number }[] | null;
  requested_total_amount: number | null;
  reason: string | null;
  created_at: string;
};

// Customer-facing label for how the order is being paid for.
//   razorpay + paid    → "Paid"
//   cod                → "Cash on Delivery"
//   razorpay + failed  → "Payment failed"
//   anything else      → "Awaiting payment" (razorpay 'created'/'pending')
function paymentLabel(method: string | null, status: string | null): string {
  const m = (method ?? "").toLowerCase();
  const s = (status ?? "").toLowerCase();
  if (s === "paid") return "Paid";
  if (m === "cod") return "Cash on Delivery";
  if (s === "failed") return "Payment failed";
  return "Awaiting payment";
}

function paymentColor(method: string | null, status: string | null): string {
  const m = (method ?? "").toLowerCase();
  const s = (status ?? "").toLowerCase();
  if (s === "paid") return "#024628";
  if (s === "failed") return "#991B1B";
  if (m === "cod") return "#024628";
  return "#024628";
}

function formatDeliveryDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatSlot(slot: string | null): string {
  if (!slot) return "";
  // e.g. "07:00-08:00" → "7–8 AM"
  const m = slot.match(/^(\d{1,2}):\d{2}-(\d{1,2}):\d{2}$/);
  if (!m) return slot;
  const fmt = (h: number) => {
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return { h12, ampm };
  };
  const a = fmt(Number(m[1]));
  const b = fmt(Number(m[2]));
  return a.ampm === b.ampm
    ? `${a.h12}–${b.h12} ${b.ampm}`
    : `${a.h12} ${a.ampm} – ${b.h12} ${b.ampm}`;
}

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "delivered" || s === "completed") return "#024628";
  if (s === "cancelled") return "#991B1B";
  if (s === "confirmed" || s === "out_for_delivery") return "#024628";
  return "#024628";
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = (params?.id || "").toString();

  const [order, setOrder] = useState<Order | null>(null);
  const [changeRequest, setChangeRequest] = useState<ChangeRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  // Guard so background polls/refetches can't run while a request is
  // already in flight, and so we never flip back to the loading state
  // after the first successful load.
  const inFlightRef = useRef(false);
  const loadedOnceRef = useRef(false);

  const fetchOrder = useCallback(async () => {
    if (!id || inFlightRef.current) return;
    inFlightRef.current = true;
    if (!loadedOnceRef.current) setLoading(true);
    try {
      const r = await fetch(`/api/orders/${encodeURIComponent(id)}`, {
        cache: "no-store",
        credentials: "include",
      });
      if (r.status === 401) {
        if (!loadedOnceRef.current) setError("verify");
        return;
      }
      if (!r.ok) {
        if (!loadedOnceRef.current) setError("notfound");
        return;
      }
      const d = await r.json();
      setOrder(d.order as Order);
      setChangeRequest((d.change_request as ChangeRequest) ?? null);
      setError(null);
      loadedOnceRef.current = true;
    } catch {
      if (!loadedOnceRef.current) setError("notfound");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [id]);

  // Initial load + live refresh: poll every 20s and refetch whenever the
  // tab regains focus / becomes visible, so status changes made in the
  // dashboard show up without a manual reload.
  useEffect(() => {
    loadedOnceRef.current = false;
    void fetchOrder();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void fetchOrder();
    }, 20000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchOrder();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [fetchOrder]);

  // GA4 purchase — this page is where finishOrder() lands the customer
  // after place_order (the /checkout/success interstitial is orphaned),
  // so it's the canonical spot to fire the ecommerce purchase event.
  //
  // Fires exactly ONCE per order.id, ever. Guarded by localStorage
  // (not sessionStorage) because /orders/[id] is bookmarkable — a
  // customer may revisit later to check delivery status, and we must
  // not re-fire the purchase on those return visits and double-count
  // revenue. Cancelled / failed orders are excluded so we don't count
  // them as revenue either.
  useEffect(() => {
    if (!order) return;
    if (isCancelled(order.status)) return;
    if (order.cancelled_at) return;
    if ((order.payment_status ?? "").toLowerCase() === "failed") return;
    const storageKey = `cdx_ga_purchase_${order.id}`;
    try {
      if (localStorage.getItem(storageKey)) return;
    } catch {
      /* private mode / storage disabled — fall through and still fire */
    }
    trackPurchase({
      transactionId: order.id,
      value: Number(order.total_amount) || 0,
      items: (order.items ?? []).map((it) => ({
        item_id: it.slug ?? it.name,
        item_name: it.name,
        quantity: it.qty,
        price:
          it.price_inr ??
          (it.qty ? (it.line_total ?? 0) / it.qty : undefined),
      })),
    });
    try {
      localStorage.setItem(storageKey, "1");
    } catch {
      /* ignore */
    }
  }, [order]);

  // "Pay Now" — convert a COD order to a paid Razorpay order without
  // creating a new order. Mirrors the checkout page's payOnline() flow:
  // create a Razorpay order for the existing order id, open the gateway,
  // verify server-side, then refresh so the row flips to "Paid".
  const payNow = useCallback(async () => {
    if (!id || paying) return;
    setPayError(null);
    setPaying(true);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(id)}/pay`, {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as {
        razorpay_order_id?: string;
        amount?: number;
        currency?: string;
        key_id?: string;
        error?: string;
      };
      if (!res.ok || !data.razorpay_order_id) {
        setPayError(data.error ?? "Could not start payment. Please try again.");
        setPaying(false);
        return;
      }

      const loaded = await new Promise<boolean>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((window as any).Razorpay) {
          resolve(true);
          return;
        }
        const s = document.createElement("script");
        s.src = "https://checkout.razorpay.com/v1/checkout.js";
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.body.appendChild(s);
      });
      if (!loaded) {
        setPayError("Failed to load payment gateway. Please try again.");
        setPaying(false);
        return;
      }

      const options = {
        key: data.key_id,
        amount: data.amount, // server-computed paise
        currency: data.currency ?? "INR",
        name: "Cadieux",
        description: "Protein Bread",
        order_id: data.razorpay_order_id,
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const r = await fetch(
              `/api/orders/${encodeURIComponent(id)}/pay/verify`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                }),
              },
            );
            const d = (await r.json().catch(() => ({}))) as { ok?: boolean };
            if (!r.ok || !d.ok) {
              setPayError(
                "We received your payment but couldn't confirm it automatically. " +
                  "It'll be reconciled shortly — contact support if it doesn't update.",
              );
            } else {
              setPayError(null);
            }
          } finally {
            setPaying(false);
            void fetchOrder();
          }
        },
        modal: {
          ondismiss: () => {
            setPaying(false);
            setPayError("Payment cancelled. Your order is unchanged.");
          },
        },
        theme: { color: "#024628" },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rzp = new (window as any).Razorpay(options);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rzp.on("payment.failed", () => {
        setPaying(false);
        setPayError("Payment failed. Your order is unchanged — you can try again.");
      });
      rzp.open();
    } catch {
      setPayError("Something went wrong starting the payment. Please try again.");
      setPaying(false);
    }
  }, [id, paying, fetchOrder]);

  const items = (order?.items ?? []).filter(
    (it) => it && typeof it.name === "string" && Number(it.qty) > 0,
  );

  const subtotal = items.reduce(
    (sum, it) =>
      sum +
      (typeof it.line_total === "number"
        ? it.line_total
        : Number(it.price_inr ?? 0) * Number(it.qty ?? 0)),
    0,
  );

  const shortId = id ? id.slice(0, 8).toUpperCase() : "";

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#C0C8CE",
        position: "relative",
        overflowX: "clip",
      }}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: GRAIN,
          opacity: 0.04, mixBlendMode: "multiply",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      <Link
        href="/orders"
        style={{
          position: "fixed",
          top: 24,
          left: 20,
          zIndex: 101,
          fontFamily: "var(--font-body)",
          fontSize: 10,
          fontWeight: 200,
          letterSpacing: "0.35em",
          textTransform: "uppercase",
          color: "#024628",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 14 }}>←</span> Orders
      </Link>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "100px clamp(24px,6vw,80px) 140px",
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        {loading && (
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 15,
              color: "rgba(2,70,40,0.55)",
              letterSpacing: "0.1em",
            }}
          >
            Loading…
          </p>
        )}

        {!loading && error === "verify" && (
          <div>
            <h1
              style={{
                margin: "0 0 18px",
                fontFamily: "var(--font-heading)",
                fontSize: "clamp(36px,8vw,64px)",
                fontWeight: 300,
                color: "#024628",
                letterSpacing: "0.02em",
                lineHeight: 1.05,
              }}
            >
              Verify your phone
            </h1>
            <p
              style={{
                margin: "0 0 28px",
                fontFamily: "var(--font-body)",
                fontSize: 15,
                fontWeight: 200,
                color: "rgba(2,70,40,0.7)",
                lineHeight: 1.7,
              }}
            >
              For your security, we ask you to verify your phone before showing
              order details. Open your orders list to sign in with the number
              you used at checkout.
            </p>
            <Link
              href="/orders"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                height: 48,
                padding: "0 28px",
                background: "#f59e0b",
                textDecoration: "none",
                fontFamily: "var(--font-body)",
                fontSize: 11,
                fontWeight: 400,
                letterSpacing: "0.4em",
                textTransform: "uppercase",
                color: "#024628",
              }}
            >
              Go to Orders
            </Link>
          </div>
        )}

        {!loading && error === "notfound" && (
          <div>
            <h1
              style={{
                margin: "0 0 18px",
                fontFamily: "var(--font-heading)",
                fontSize: "clamp(36px,8vw,64px)",
                fontWeight: 300,
                color: "#024628",
                letterSpacing: "0.02em",
                lineHeight: 1.05,
              }}
            >
              Order not found
            </h1>
            <p
              style={{
                margin: "0 0 28px",
                fontFamily: "var(--font-body)",
                fontSize: 15,
                fontWeight: 200,
                color: "rgba(2,70,40,0.7)",
                lineHeight: 1.7,
              }}
            >
              We couldn&apos;t find this order on your account. Double-check the
              link, or browse all your orders.
            </p>
            <Link
              href="/orders"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                height: 48,
                padding: "0 28px",
                background: "transparent",
                border: "1px solid rgba(2,70,40,0.25)",
                textDecoration: "none",
                fontFamily: "var(--font-body)",
                fontSize: 11,
                fontWeight: 300,
                letterSpacing: "0.4em",
                textTransform: "uppercase",
                color: "rgba(2,70,40,0.75)",
              }}
            >
              All Orders
            </Link>
          </div>
        )}

        {!loading && order && (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 16,
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 11,
                  fontWeight: 200,
                  letterSpacing: "0.35em",
                  textTransform: "uppercase",
                  color: "#024628",
                }}
              >
                Order #{shortId}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 11,
                  fontWeight: 300,
                  letterSpacing: "0.3em",
                  textTransform: "uppercase",
                  color: statusColor(order.status),
                }}
              >
                {order.status}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-end",
                gap: 16,
                margin: "0 0 36px",
              }}
            >
              <h1
                style={{
                  margin: 0,
                  fontFamily: "var(--font-heading)",
                  fontSize: "clamp(40px,9vw,72px)",
                  fontWeight: 300,
                  color: "#024628",
                  letterSpacing: "0.02em",
                  lineHeight: 1.05,
                }}
              >
                Your Order
              </h1>
              <ShareButton
                title="Cadieux"
                text="Just ordered Cadieux — high-protein bread, baked in Vizag. cadieux.in"
                size={36}
              />
            </div>

            {/* Status progress tracker. Hidden for cancelled orders —
                the dedicated Cancellation section below already tells
                the customer everything they need. */}
            {!isCancelled(order.status) && (
              <StatusTracker
                status={order.status}
                statusUpdatedAt={order.status_updated_at ?? null}
              />
            )}

            {/* Delivery details */}
            <Section title="Delivery">
              {order.delivery_date && (
                <Row
                  label="Date"
                  value={formatDeliveryDate(order.delivery_date)}
                />
              )}
              {order.delivery_slot && (
                <Row label="Slot" value={formatSlot(order.delivery_slot)} />
              )}
              {order.delivery_address && (
                <Row label="Address" value={String(order.delivery_address)} />
              )}
              <DeliveryEditor
                orderId={id}
                order={order}
                changeRequest={changeRequest}
                onChanged={fetchOrder}
              />
              <AddressEditor
                orderId={id}
                order={order}
                changeRequest={changeRequest}
                onChanged={fetchOrder}
              />
            </Section>

            {/* Items */}
            <Section title="Items">
              {items.length === 0 && (
                <p
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-body)",
                    fontSize: 14,
                    fontWeight: 200,
                    color: "rgba(2,70,40,0.6)",
                  }}
                >
                  No items recorded.
                </p>
              )}
              {items.map((it, i) => {
                const line =
                  typeof it.line_total === "number"
                    ? it.line_total
                    : Number(it.price_inr ?? 0) * Number(it.qty ?? 0);
                return (
                  <div
                    key={`${it.slug ?? it.name}-${i}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 16,
                      padding: "12px 0",
                      borderBottom: "1px solid rgba(2,70,40,0.15)",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p
                        style={{
                          margin: 0,
                          fontFamily: "var(--font-body)",
                          fontSize: 15,
                          fontWeight: 300,
                          color: "#024628",
                          letterSpacing: "0.02em",
                        }}
                      >
                        {it.name}
                      </p>
                      <p
                        style={{
                          margin: "3px 0 0",
                          fontFamily: "var(--font-body)",
                          fontSize: 11,
                          fontWeight: 200,
                          letterSpacing: "0.25em",
                          textTransform: "uppercase",
                          color: "rgba(2,70,40,0.6)",
                        }}
                      >
                        Qty {it.qty}
                        {it.kind === "sub" ? " · Subscription" : ""}
                      </p>
                    </div>
                    <span
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: 14,
                        fontWeight: 200,
                        color: "#024628",
                        whiteSpace: "nowrap",
                      }}
                    >
                      ₹{Number(line).toLocaleString("en-IN")}
                    </span>
                  </div>
                );
              })}
              <ItemEditor
                orderId={id}
                order={order}
                changeRequest={changeRequest}
                deliveryFee={order.delivery_fee}
                onChanged={fetchOrder}
              />
            </Section>

            {/* Totals */}
            <Section title="Total">
              <Row
                label="Subtotal"
                value={`₹${Number(subtotal).toLocaleString("en-IN")}`}
              />
              {typeof order.delivery_fee === "number" && (
                <Row
                  label="Delivery"
                  value={
                    order.delivery_fee > 0
                      ? `₹${Number(order.delivery_fee).toLocaleString("en-IN")}`
                      : "Free"
                  }
                />
              )}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 16,
                  paddingTop: 14,
                  marginTop: 8,
                  borderTop: "1px solid rgba(2,70,40,0.2)",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 11,
                    fontWeight: 300,
                    letterSpacing: "0.35em",
                    textTransform: "uppercase",
                    color: "rgba(2,70,40,0.7)",
                  }}
                >
                  Grand Total
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 22,
                    fontWeight: 300,
                    color: "#024628",
                  }}
                >
                  ₹{Number(order.total_amount).toLocaleString("en-IN")}
                </span>
              </div>
            </Section>

            {/* Payment */}
            <Section title="Payment">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 16,
                  padding: "8px 0",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 11,
                    fontWeight: 200,
                    letterSpacing: "0.3em",
                    textTransform: "uppercase",
                    color: "rgba(2,70,40,0.6)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Status
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 13,
                    fontWeight: 300,
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    color: paymentColor(
                      order.payment_method,
                      order.payment_status,
                    ),
                    textAlign: "right",
                  }}
                >
                  {paymentLabel(order.payment_method, order.payment_status)}
                </span>
              </div>

              {/* Pay Now — only for unpaid COD orders that aren't cancelled,
                  and never while a delivery change-request is pending. */}
              {(order.payment_method ?? "").toLowerCase() === "cod" &&
                (order.payment_status ?? "").toLowerCase() !== "paid" &&
                !isCancelled(order.status) &&
                !changeRequest && (
                  <div style={{ marginTop: 16 }}>
                    <button
                      type="button"
                      onClick={payNow}
                      disabled={paying}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "100%",
                        height: 50,
                        padding: "0 28px",
                        background: paying ? "rgba(245,158,11,0.5)" : "#f59e0b",
                        border: "none",
                        cursor: paying ? "default" : "pointer",
                        fontFamily: "var(--font-body)",
                        fontSize: 11,
                        fontWeight: 400,
                        letterSpacing: "0.4em",
                        textTransform: "uppercase",
                        color: "#024628",
                      }}
                    >
                      {paying
                        ? "Opening payment…"
                        : `Pay Now · ₹${Number(order.total_amount).toLocaleString("en-IN")}`}
                    </button>
                    {payError && (
                      <p
                        style={{
                          margin: "12px 0 0",
                          fontFamily: "var(--font-body)",
                          fontSize: 12,
                          fontWeight: 200,
                          lineHeight: 1.6,
                          color: "#991B1B",
                        }}
                      >
                        {payError}
                      </p>
                    )}
                  </div>
                )}
            </Section>

            {order.cancelled_at && (
              <Section title="Cancellation">
                <Row
                  label="Cancelled"
                  value={new Date(order.cancelled_at).toLocaleString("en-IN")}
                />
                {order.cancellation_reason && (
                  <Row label="Reason" value={order.cancellation_reason} />
                )}
                {order.refund_status && (
                  <Row label="Refund" value={order.refund_status} />
                )}
              </Section>
            )}

            <p
              style={{
                margin: "32px 0 0",
                fontFamily: "var(--font-body)",
                fontSize: 11,
                fontWeight: 200,
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: "rgba(2,70,40,0.55)",
              }}
            >
              Placed{" "}
              {new Date(order.created_at).toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2
        style={{
          margin: "0 0 14px",
          fontFamily: "var(--font-body)",
          fontSize: 11,
          fontWeight: 300,
          letterSpacing: "0.4em",
          textTransform: "uppercase",
          color: "#024628",
        }}
      >
        {title}
      </h2>
      <div>{children}</div>
    </section>
  );
}

function StatusTracker({
  status,
  statusUpdatedAt,
}: {
  status: string;
  statusUpdatedAt: string | null;
}) {
  const stage = toStage(status);
  // Unknown / non-tracker state (e.g. pending_payment): fall back to
  // a single status pill so we never render an empty progress bar.
  if (!stage) {
    return (
      <section style={{ marginBottom: 36 }}>
        <h2
          style={{
            margin: "0 0 14px",
            fontFamily: "var(--font-body)",
            fontSize: 11,
            fontWeight: 300,
            letterSpacing: "0.4em",
            textTransform: "uppercase",
            color: "#024628",
          }}
        >
          Status
        </h2>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-body)",
            fontSize: 14,
            fontWeight: 300,
            letterSpacing: "0.05em",
            color: "#024628",
            textTransform: "uppercase",
          }}
        >
          {status}
        </p>
      </section>
    );
  }

  const currentIdx = stageIndex(stage);

  return (
    <section style={{ marginBottom: 40 }}>
      <h2
        style={{
          margin: "0 0 18px",
          fontFamily: "var(--font-body)",
          fontSize: 11,
          fontWeight: 300,
          letterSpacing: "0.4em",
          textTransform: "uppercase",
          color: "#024628",
        }}
      >
        Status
      </h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${ORDER_STAGES.length}, 1fr)`,
          alignItems: "start",
          gap: 0,
          position: "relative",
        }}
      >
        {ORDER_STAGES.map((s, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          const dotBg = done || active ? "#024628" : "transparent";
          const dotBorder = done || active
            ? "#024628"
            : "rgba(2,70,40,0.25)";
          const labelColor = active
            ? "#024628"
            : done
            ? "rgba(2,70,40,0.8)"
            : "rgba(2,70,40,0.6)";
          return (
            <div
              key={s}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                position: "relative",
              }}
            >
              {/* Connector line to the previous dot. Coloured if the
                  *previous* stage is done; uses absolute positioning so
                  the dots stay centred in their grid cell. */}
              {i > 0 && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: 9,
                    right: "50%",
                    width: "100%",
                    height: 2,
                    background:
                      i <= currentIdx
                        ? "#024628"
                        : "rgba(2,70,40,0.2)",
                  }}
                />
              )}
              <span
                aria-hidden
                style={{
                  position: "relative",
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  background: dotBg,
                  border: `1.5px solid ${dotBorder}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#024628",
                  fontFamily: "var(--font-body)",
                  fontSize: 11,
                  fontWeight: 500,
                  lineHeight: 1,
                  boxShadow: active
                    ? "0 0 0 4px rgba(2,70,40,0.15)"
                    : undefined,
                }}
              >
                {done ? "✓" : active ? "•" : ""}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 10,
                  fontWeight: 300,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: labelColor,
                  textAlign: "center",
                  lineHeight: 1.3,
                }}
              >
                {STAGE_LABEL[s]}
              </span>
            </div>
          );
        })}
      </div>

      {statusUpdatedAt && (
        <p
          style={{
            margin: "20px 0 0",
            fontFamily: "var(--font-body)",
            fontSize: 11,
            fontWeight: 200,
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            color: "rgba(2,70,40,0.6)",
          }}
        >
          Updated{" "}
          {new Date(statusUpdatedAt).toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      )}
    </section>
  );
}

// Customer-driven delivery change-request UI for COD/unpaid orders.
// Renders one of three states inside the Delivery section:
//   • a pending "Request pending" card (old→new diff + Cancel) when a
//     change-request is awaiting admin approval;
//   • an "Edit delivery" trigger when no request is pending;
//   • an inline form (date pills / slot pills / address / reason) once
//     editing. Submitting POSTs a change-request; the order is untouched
//     until an admin approves. Returns null for non-editable orders
//     (paid, non-COD, or cancelled) so paid orders get no edit affordance.
function DeliveryEditor({
  orderId,
  order,
  changeRequest,
  onChanged,
}: {
  orderId: string;
  order: Order;
  changeRequest: ChangeRequest | null;
  onChanged: () => void;
}) {
  const paid = (order.payment_status ?? "").toLowerCase() === "paid";
  const cod = (order.payment_method ?? "").toLowerCase() === "cod";
  // Date/time can be changed on a paid order (any method) OR a COD-unpaid
  // order; never on a cancelled one.
  const editable = !isCancelled(order.status) && (paid || cod);
  // The address can change the delivery fee, so it's only editable while the
  // order is unpaid.
  const canEditAddress = editable && !paid;
  const reqType = (changeRequest?.type ?? "delivery").toLowerCase();

  const dates = useMemo(() => nextDeliveryDates(7), []);

  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState<string>(order.delivery_date ?? "");
  const [slot, setSlot] = useState<string>(order.delivery_slot ?? "");
  const [address, setAddress] = useState<string>(order.delivery_address ?? "");
  const [reason, setReason] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const slots = useMemo(() => (date ? bookableSlots(date) : []), [date]);

  if (!editable) return null;

  const openForm = () => {
    // Seed the form from the order, defaulting date to the first available
    // pill when the stored date is no longer bookable.
    const seedDate =
      order.delivery_date && dates.includes(order.delivery_date)
        ? order.delivery_date
        : dates[0] ?? "";
    setDate(seedDate);
    setSlot(order.delivery_slot ?? "");
    setAddress(order.delivery_address ?? "");
    setReason("");
    setErr(null);
    setEditing(true);
  };

  const submit = async () => {
    if (busy) return;
    setErr(null);
    const trimmedAddress = address.trim();
    const trimmedReason = reason.trim();
    // Send only the fields that differ from the current order; the API
    // requires at least one change.
    const body: Record<string, string> = {};
    if (date && date !== (order.delivery_date ?? "")) body.requested_delivery_date = date;
    if (slot && slot !== (order.delivery_slot ?? "")) body.requested_delivery_slot = slot;
    if (canEditAddress && trimmedAddress && trimmedAddress !== (order.delivery_address ?? ""))
      body.requested_delivery_address = trimmedAddress;
    if (Object.keys(body).length === 0) {
      setErr("Change at least one of date, slot or address.");
      return;
    }
    if (trimmedReason) body.reason = trimmedReason;
    setBusy(true);
    try {
      const r = await fetch(
        `/api/orders/${encodeURIComponent(orderId)}/change-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        },
      );
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErr(d.error ?? "Could not send your request. Please try again.");
        setBusy(false);
        return;
      }
      setEditing(false);
      setBusy(false);
      onChanged();
    } catch {
      setErr("Something went wrong. Please try again.");
      setBusy(false);
    }
  };

  const cancelRequest = async () => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch(
        `/api/orders/${encodeURIComponent(orderId)}/change-request/cancel`,
        { method: "POST", credentials: "include" },
      );
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        setErr(d.error ?? "Could not cancel the request. Please try again.");
        setBusy(false);
        return;
      }
      setBusy(false);
      onChanged();
    } catch {
      setErr("Something went wrong. Please try again.");
      setBusy(false);
    }
  };

  // A pending request of a DIFFERENT type (items or address) blocks editing
  // here — only one pending request per order. Show a note instead of the
  // editor.
  if (changeRequest && reqType !== "delivery") {
    const otherLabel = reqType === "address" ? "address" : "item";
    return (
      <p
        style={{
          marginTop: 14,
          fontFamily: "var(--font-body)",
          fontSize: 12,
          fontWeight: 200,
          lineHeight: 1.6,
          color: "rgba(2,70,40,0.65)",
        }}
      >
        You have a pending {otherLabel} change awaiting approval — cancel it to
        request a delivery change.
      </p>
    );
  }

  // ── Pending request card (old → new diff) ────────────────────────────
  if (changeRequest && !editing) {
    const diffs: { label: string; from: string; to: string }[] = [];
    if (changeRequest.requested_delivery_date) {
      diffs.push({
        label: "Date",
        from: formatDeliveryDate(order.delivery_date),
        to: formatDeliveryDate(changeRequest.requested_delivery_date),
      });
    }
    if (changeRequest.requested_delivery_slot) {
      diffs.push({
        label: "Slot",
        from: formatSlotForDisplay(order.delivery_slot),
        to: formatSlotForDisplay(changeRequest.requested_delivery_slot),
      });
    }
    if (changeRequest.requested_delivery_address) {
      diffs.push({
        label: "Address",
        from: String(order.delivery_address ?? "—"),
        to: String(changeRequest.requested_delivery_address),
      });
    }
    return (
      <div
        style={{
          marginTop: 16,
          padding: "16px 18px",
          border: "1px solid #024628",
          background: "#FBF3D4",
          borderRadius: 4,
        }}
      >
        <p
          style={{
            margin: "0 0 12px",
            fontFamily: "var(--font-body)",
            fontSize: 11,
            fontWeight: 400,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "#024628",
          }}
        >
          Change requested · awaiting approval
        </p>
        {diffs.map((d) => (
          <div key={d.label} style={{ marginBottom: 10 }}>
            <p
              style={{
                margin: "0 0 2px",
                fontFamily: "var(--font-body)",
                fontSize: 10,
                fontWeight: 200,
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: "rgba(2,70,40,0.6)",
              }}
            >
              {d.label}
            </p>
            <p
              style={{
                margin: 0,
                fontFamily: "var(--font-body)",
                fontSize: 14,
                fontWeight: 200,
                color: "#024628",
                lineHeight: 1.5,
              }}
            >
              <span style={{ color: "rgba(2,70,40,0.6)", textDecoration: "line-through" }}>
                {d.from}
              </span>
              {"  →  "}
              <span style={{ color: "#024628" }}>{d.to}</span>
            </p>
          </div>
        ))}
        {changeRequest.reason && (
          <p
            style={{
              margin: "8px 0 0",
              fontFamily: "var(--font-body)",
              fontSize: 12,
              fontWeight: 200,
              fontStyle: "italic",
              color: "rgba(2,70,40,0.7)",
              lineHeight: 1.6,
            }}
          >
            “{changeRequest.reason}”
          </p>
        )}
        {err && (
          <p style={{ margin: "10px 0 0", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "#991B1B" }}>
            {err}
          </p>
        )}
        <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={cancelRequest}
            disabled={busy}
            style={{
              height: 40,
              padding: "0 18px",
              background: "transparent",
              border: "1px solid rgba(255,129,129,0.4)",
              cursor: busy ? "default" : "pointer",
              fontFamily: "var(--font-body)",
              fontSize: 10,
              fontWeight: 300,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "#991B1B",
            }}
          >
            {busy ? "Cancelling…" : "Cancel request"}
          </button>
          <button
            type="button"
            onClick={openForm}
            disabled={busy}
            style={{
              height: 40,
              padding: "0 18px",
              background: "transparent",
              border: "1px solid rgba(2,70,40,0.25)",
              cursor: busy ? "default" : "pointer",
              fontFamily: "var(--font-body)",
              fontSize: 10,
              fontWeight: 300,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "rgba(2,70,40,0.75)",
            }}
          >
            Edit again
          </button>
        </div>
      </div>
    );
  }

  // ── Trigger button (no pending request, not yet editing) ─────────────
  if (!editing) {
    return (
      <div style={{ marginTop: 14 }}>
        <button
          type="button"
          onClick={openForm}
          style={{
            height: 40,
            padding: "0 18px",
            background: "transparent",
            border: "1px solid rgba(2,70,40,0.25)",
            cursor: "pointer",
            fontFamily: "var(--font-body)",
            fontSize: 10,
            fontWeight: 300,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "rgba(2,70,40,0.8)",
          }}
        >
          Edit delivery
        </button>
      </div>
    );
  }

  // ── Inline edit form ─────────────────────────────────────────────────
  return (
    <div
      style={{
        marginTop: 16,
        padding: "18px",
        border: "1px solid rgba(2,70,40,0.2)",
        borderRadius: 4,
      }}
    >
      <p
        style={{
          margin: "0 0 16px",
          fontFamily: "var(--font-body)",
          fontSize: 12,
          fontWeight: 200,
          lineHeight: 1.6,
          color: "rgba(2,70,40,0.7)",
        }}
      >
        Request a change to your delivery. Your order stays as-is until we
        approve it.
      </p>

      {/* Date pills */}
      <p style={{ ...editorLabel }}>Date</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {dates.map((d) => {
          const sel = d === date;
          return (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDate(d);
                // Reset slot when changing date so we never keep a slot that's
                // now too soon on the new date.
                setSlot("");
              }}
              style={{
                height: 36,
                padding: "0 14px",
                background: sel ? "#024628" : "transparent",
                border: "1px solid #024628",
                cursor: "pointer",
                fontFamily: "var(--font-body)",
                fontSize: 11,
                fontWeight: 300,
                letterSpacing: "0.1em",
                color: sel ? "#FBF3D4" : "#024628",
              }}
            >
              {dateLabel(d)}
            </button>
          );
        })}
      </div>

      {/* Slot pills */}
      <p style={{ ...editorLabel }}>Slot</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {slots.map((s) => {
          const sel = s.value === slot;
          return (
            <button
              key={s.value}
              type="button"
              disabled={s.disabled}
              onClick={() => setSlot(s.value)}
              style={{
                height: 36,
                padding: "0 12px",
                background: sel ? "#024628" : "transparent",
                border: "1px solid #024628",
                cursor: s.disabled ? "not-allowed" : "pointer",
                opacity: s.disabled ? 0.3 : 1,
                fontFamily: "var(--font-body)",
                fontSize: 11,
                fontWeight: 300,
                letterSpacing: "0.05em",
                color: sel ? "#FBF3D4" : "#024628",
                whiteSpace: "nowrap",
              }}
            >
              {s.rangeLabel}
            </button>
          );
        })}
        {date && slots.length === 0 && (
          <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "rgba(2,70,40,0.6)" }}>
            No slots available for this date.
          </span>
        )}
      </div>

      {/* Address — hidden on paid orders (it can change the delivery fee). */}
      {canEditAddress && (
        <>
          <p style={{ ...editorLabel }}>Address</p>
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={3}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 12px",
              marginBottom: 16,
              background: "#FBF3D4",
              border: "1px solid #024628",
              color: "#024628",
              caretColor: "#024628",
              fontFamily: "var(--font-body)",
              fontSize: 14,
              fontWeight: 200,
              resize: "vertical",
            }}
          />
        </>
      )}

      {/* Reason (optional) */}
      <p style={{ ...editorLabel }}>Reason (optional)</p>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why are you changing this?"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "10px 12px",
          marginBottom: 16,
          background: "#FBF3D4",
          border: "1px solid #024628",
          color: "#024628",
          caretColor: "#024628",
          fontFamily: "var(--font-body)",
          fontSize: 14,
          fontWeight: 200,
        }}
      />

      {err && (
        <p style={{ margin: "0 0 12px", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "#991B1B", lineHeight: 1.6 }}>
          {err}
        </p>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          style={{
            height: 44,
            padding: "0 24px",
            background: busy ? "rgba(245,158,11,0.5)" : "#f59e0b",
            border: "none",
            cursor: busy ? "default" : "pointer",
            fontFamily: "var(--font-body)",
            fontSize: 11,
            fontWeight: 400,
            letterSpacing: "0.35em",
            textTransform: "uppercase",
            color: "#024628",
          }}
        >
          {busy ? "Sending…" : "Send request"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setErr(null);
          }}
          disabled={busy}
          style={{
            height: 44,
            padding: "0 20px",
            background: "transparent",
            border: "1px solid rgba(2,70,40,0.25)",
            cursor: busy ? "default" : "pointer",
            fontFamily: "var(--font-body)",
            fontSize: 11,
            fontWeight: 300,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "rgba(2,70,40,0.75)",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const editorLabel: React.CSSProperties = {
  margin: "0 0 8px",
  fontFamily: "var(--font-body)",
  fontSize: 10,
  fontWeight: 300,
  letterSpacing: "0.3em",
  textTransform: "uppercase",
  color: "#024628",
};

// ItemEditor — customer-facing "change item quantities" control. Mirrors
// DeliveryEditor. COD-unpaid-not-cancelled only (items are COD-only). Lets the
// customer adjust the qty (1..99) of existing kind:"once" lines; sub lines are
// read-only. The new total shown is informational only — the server recomputes
// authoritatively from the order's own price snapshot on send and on approve.
function ItemEditor({
  orderId,
  order,
  changeRequest,
  deliveryFee,
  onChanged,
}: {
  orderId: string;
  order: Order;
  changeRequest: ChangeRequest | null;
  deliveryFee: number | null;
  onChanged: () => void;
}) {
  const editable =
    (order.payment_method ?? "").toLowerCase() === "cod" &&
    (order.payment_status ?? "").toLowerCase() !== "paid" &&
    !isCancelled(order.status);

  const reqType = (changeRequest?.type ?? "delivery").toLowerCase();

  // Editable (once) lines and read-only (sub) lines from the order snapshot.
  const onceLines = (order.items ?? []).filter(
    (it): it is OrderItem & { slug: string } =>
      !!it && it.kind !== "sub" && typeof it.slug === "string",
  );
  const subLineTotal = (order.items ?? [])
    .filter((it) => it && it.kind === "sub")
    .reduce(
      (sum, it) =>
        sum +
        (typeof it.line_total === "number"
          ? it.line_total
          : Number(it.price_inr ?? 0) * Number(it.qty ?? 0)),
      0,
    );

  const fee = Number(deliveryFee ?? 0);

  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!editable) return null;
  if (onceLines.length === 0 && reqType !== "items") return null;

  const seedQty = () => {
    const seed: Record<string, number> = {};
    for (const it of onceLines) seed[it.slug] = Number(it.qty ?? 1);
    return seed;
  };

  const openForm = () => {
    setQty(seedQty());
    setErr(null);
    setEditing(true);
  };

  const setLineQty = (slug: string, next: number) => {
    const clamped = Math.max(1, Math.min(99, Math.round(next)));
    setQty((q) => ({ ...q, [slug]: clamped }));
  };

  // Live, display-only new total from the order's own per-line prices.
  const liveSubtotal = onceLines.reduce(
    (sum, it) => sum + Number(it.price_inr ?? 0) * (qty[it.slug] ?? Number(it.qty ?? 0)),
    0,
  );
  const liveTotal = liveSubtotal + subLineTotal + fee;
  const anyChanged = onceLines.some(
    (it) => (qty[it.slug] ?? Number(it.qty ?? 0)) !== Number(it.qty ?? 0),
  );

  const submit = async () => {
    if (busy) return;
    if (!anyChanged) {
      setErr("Adjust at least one quantity.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const items = onceLines.map((it) => ({
        slug: it.slug,
        qty: qty[it.slug] ?? Number(it.qty ?? 1),
      }));
      const r = await fetch(
        `/api/orders/${encodeURIComponent(orderId)}/item-change-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ items }),
        },
      );
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErr(d.error ?? "Could not send your request. Please try again.");
        setBusy(false);
        return;
      }
      setEditing(false);
      setBusy(false);
      onChanged();
    } catch {
      setErr("Something went wrong. Please try again.");
      setBusy(false);
    }
  };

  const cancelRequest = async () => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch(
        `/api/orders/${encodeURIComponent(orderId)}/change-request/cancel`,
        { method: "POST", credentials: "include" },
      );
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        setErr(d.error ?? "Could not cancel the request. Please try again.");
        setBusy(false);
        return;
      }
      setBusy(false);
      onChanged();
    } catch {
      setErr("Something went wrong. Please try again.");
      setBusy(false);
    }
  };

  // A pending request of a DIFFERENT type (delivery or address) blocks
  // editing here.
  if (changeRequest && reqType !== "items") {
    const otherLabel = reqType === "address" ? "address" : "delivery";
    return (
      <p
        style={{
          marginTop: 16,
          fontFamily: "var(--font-body)",
          fontSize: 12,
          fontWeight: 200,
          lineHeight: 1.6,
          color: "rgba(2,70,40,0.65)",
        }}
      >
        You have a pending {otherLabel} change awaiting approval — cancel it to
        request an item change.
      </p>
    );
  }

  // ── Pending item-change card (per-line old → new qty + old → new total) ──
  if (changeRequest && reqType === "items" && !editing) {
    const reqMap = new Map(
      (changeRequest.requested_items ?? []).map((r) => [r.slug, r.qty]),
    );
    const nameBySlug = new Map(onceLines.map((it) => [it.slug, it.name]));
    const lines = Array.from(reqMap.entries()).map(([slug, newQty]) => {
      const old = onceLines.find((it) => it.slug === slug);
      return {
        slug,
        name: nameBySlug.get(slug) ?? slug,
        from: Number(old?.qty ?? 0),
        to: Number(newQty),
      };
    });
    const newTotal = Number(changeRequest.requested_total_amount ?? 0);
    return (
      <div
        style={{
          marginTop: 16,
          padding: "16px 18px",
          border: "1px solid #024628",
          background: "#FBF3D4",
          borderRadius: 4,
        }}
      >
        <p
          style={{
            margin: "0 0 12px",
            fontFamily: "var(--font-body)",
            fontSize: 11,
            fontWeight: 400,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "#024628",
          }}
        >
          Item change requested · awaiting approval
        </p>
        {lines.map((l) => (
          <div
            key={l.slug}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 16,
              marginBottom: 8,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 14,
                fontWeight: 300,
                color: "#024628",
              }}
            >
              {l.name}
            </span>
            <span
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 13,
                fontWeight: 200,
                color: "#024628",
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ color: "rgba(2,70,40,0.6)", textDecoration: "line-through" }}>
                Qty {l.from}
              </span>
              {"  →  "}
              <span style={{ color: "#024628" }}>Qty {l.to}</span>
            </span>
          </div>
        ))}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 16,
            marginTop: 10,
            paddingTop: 10,
            borderTop: "1px solid rgba(2,70,40,0.2)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 10,
              fontWeight: 300,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "rgba(2,70,40,0.7)",
            }}
          >
            New total
          </span>
          <span
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 14,
              fontWeight: 200,
              color: "#024628",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ color: "rgba(2,70,40,0.6)", textDecoration: "line-through" }}>
              ₹{Number(order.total_amount).toLocaleString("en-IN")}
            </span>
            {"  →  "}
            <span style={{ color: "#024628" }}>
              ₹{newTotal.toLocaleString("en-IN")}
            </span>
          </span>
        </div>
        {changeRequest.reason && (
          <p
            style={{
              margin: "10px 0 0",
              fontFamily: "var(--font-body)",
              fontSize: 12,
              fontWeight: 200,
              fontStyle: "italic",
              color: "rgba(2,70,40,0.7)",
              lineHeight: 1.6,
            }}
          >
            “{changeRequest.reason}”
          </p>
        )}
        {err && (
          <p style={{ margin: "10px 0 0", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "#991B1B" }}>
            {err}
          </p>
        )}
        <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={cancelRequest}
            disabled={busy}
            style={{
              height: 40,
              padding: "0 18px",
              background: "transparent",
              border: "1px solid rgba(255,129,129,0.4)",
              cursor: busy ? "default" : "pointer",
              fontFamily: "var(--font-body)",
              fontSize: 10,
              fontWeight: 300,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "#991B1B",
            }}
          >
            {busy ? "Cancelling…" : "Cancel request"}
          </button>
          <button
            type="button"
            onClick={openForm}
            disabled={busy}
            style={{
              height: 40,
              padding: "0 18px",
              background: "transparent",
              border: "1px solid rgba(2,70,40,0.25)",
              cursor: busy ? "default" : "pointer",
              fontFamily: "var(--font-body)",
              fontSize: 10,
              fontWeight: 300,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "rgba(2,70,40,0.75)",
            }}
          >
            Edit again
          </button>
        </div>
      </div>
    );
  }

  // ── Trigger button (no pending request, not yet editing) ─────────────
  if (!editing) {
    return (
      <div style={{ marginTop: 14 }}>
        <button
          type="button"
          onClick={openForm}
          style={{
            height: 40,
            padding: "0 18px",
            background: "transparent",
            border: "1px solid rgba(2,70,40,0.25)",
            cursor: "pointer",
            fontFamily: "var(--font-body)",
            fontSize: 10,
            fontWeight: 300,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "rgba(2,70,40,0.8)",
          }}
        >
          Edit items
        </button>
      </div>
    );
  }

  // ── Inline edit form (quantity steppers) ─────────────────────────────
  return (
    <div
      style={{
        marginTop: 16,
        padding: "18px",
        border: "1px solid rgba(2,70,40,0.2)",
        borderRadius: 4,
      }}
    >
      <p
        style={{
          margin: "0 0 16px",
          fontFamily: "var(--font-body)",
          fontSize: 12,
          fontWeight: 200,
          lineHeight: 1.6,
          color: "rgba(2,70,40,0.7)",
        }}
      >
        Adjust the quantities of items in your order. Your order stays as-is
        until we approve it.
      </p>

      {onceLines.map((it) => {
        const q = qty[it.slug] ?? Number(it.qty ?? 1);
        const line = Number(it.price_inr ?? 0) * q;
        return (
          <div
            key={it.slug}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              padding: "10px 0",
              borderBottom: "1px solid rgba(2,70,40,0.15)",
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <p
                style={{
                  margin: 0,
                  fontFamily: "var(--font-body)",
                  fontSize: 14,
                  fontWeight: 300,
                  color: "#024628",
                }}
              >
                {it.name}
              </p>
              <p
                style={{
                  margin: "2px 0 0",
                  fontFamily: "var(--font-body)",
                  fontSize: 12,
                  fontWeight: 200,
                  color: "rgba(2,70,40,0.65)",
                }}
              >
                ₹{Number(it.price_inr ?? 0).toLocaleString("en-IN")} · ₹
                {line.toLocaleString("en-IN")}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={() => setLineQty(it.slug, q - 1)}
                disabled={q <= 1}
                aria-label="Decrease quantity"
                style={qtyButton(q <= 1)}
              >
                −
              </button>
              <span
                style={{
                  minWidth: 28,
                  textAlign: "center",
                  fontFamily: "var(--font-body)",
                  fontSize: 15,
                  fontWeight: 300,
                  color: "#024628",
                }}
              >
                {q}
              </span>
              <button
                type="button"
                onClick={() => setLineQty(it.slug, q + 1)}
                disabled={q >= 99}
                aria-label="Increase quantity"
                style={qtyButton(q >= 99)}
              >
                +
              </button>
            </div>
          </div>
        );
      })}

      {/* Live new total (display only — server is authoritative). */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 16,
          marginTop: 12,
          paddingTop: 12,
          borderTop: "1px solid rgba(2,70,40,0.2)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 10,
            fontWeight: 300,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "rgba(2,70,40,0.7)",
          }}
        >
          New total{fee > 0 ? " · incl delivery" : ""}
        </span>
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 18,
            fontWeight: 300,
            color: "#024628",
          }}
        >
          ₹{liveTotal.toLocaleString("en-IN")}
        </span>
      </div>

      {err && (
        <p style={{ margin: "12px 0 0", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "#991B1B", lineHeight: 1.6 }}>
          {err}
        </p>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          style={{
            height: 44,
            padding: "0 24px",
            background: busy ? "rgba(245,158,11,0.5)" : "#f59e0b",
            border: "none",
            cursor: busy ? "default" : "pointer",
            fontFamily: "var(--font-body)",
            fontSize: 11,
            fontWeight: 400,
            letterSpacing: "0.35em",
            textTransform: "uppercase",
            color: "#024628",
          }}
        >
          {busy ? "Sending…" : "Send request"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setErr(null);
          }}
          disabled={busy}
          style={{
            height: 44,
            padding: "0 20px",
            background: "transparent",
            border: "1px solid rgba(2,70,40,0.25)",
            cursor: busy ? "default" : "pointer",
            fontFamily: "var(--font-body)",
            fontSize: 11,
            fontWeight: 300,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "rgba(2,70,40,0.75)",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// AddressEditor — customer-facing "change just the delivery address" control.
// Broader gate than DeliveryEditor: works on ANY UNPAID order (payment_status
// != 'paid'), not just COD. Paid orders LOCK the address (no edit affordance).
// Submits as type='address' so it stays cleanly separated from delivery
// (date/slot) edits and item-qty edits. Single-pending per order is enforced
// at the DB level by the partial unique index across ALL types.
function AddressEditor({
  orderId,
  order,
  changeRequest,
  onChanged,
}: {
  orderId: string;
  order: Order;
  changeRequest: ChangeRequest | null;
  onChanged: () => void;
}) {
  const paid = (order.payment_status ?? "").toLowerCase() === "paid";
  const editable = !isCancelled(order.status) && !paid;
  const reqType = (changeRequest?.type ?? "delivery").toLowerCase();

  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState<string>(order.delivery_address ?? "");
  const [reason, setReason] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!editable) return null;

  const openForm = () => {
    setAddress(order.delivery_address ?? "");
    setReason("");
    setErr(null);
    setEditing(true);
  };

  const submit = async () => {
    if (busy) return;
    setErr(null);
    const trimmedAddress = address.trim();
    if (!trimmedAddress) {
      setErr("Enter a new address.");
      return;
    }
    if (trimmedAddress === (order.delivery_address ?? "")) {
      setErr("Enter a different address.");
      return;
    }
    const body: Record<string, string> = {
      requested_delivery_address: trimmedAddress,
    };
    const trimmedReason = reason.trim();
    if (trimmedReason) body.reason = trimmedReason;
    setBusy(true);
    try {
      const r = await fetch(
        `/api/orders/${encodeURIComponent(orderId)}/address-change-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        },
      );
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErr(d.error ?? "Could not send your request. Please try again.");
        setBusy(false);
        return;
      }
      setEditing(false);
      setBusy(false);
      onChanged();
    } catch {
      setErr("Something went wrong. Please try again.");
      setBusy(false);
    }
  };

  const cancelRequest = async () => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch(
        `/api/orders/${encodeURIComponent(orderId)}/change-request/cancel`,
        { method: "POST", credentials: "include" },
      );
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        setErr(d.error ?? "Could not cancel the request. Please try again.");
        setBusy(false);
        return;
      }
      setBusy(false);
      onChanged();
    } catch {
      setErr("Something went wrong. Please try again.");
      setBusy(false);
    }
  };

  // A pending request of a DIFFERENT type (delivery or items) blocks this
  // editor — only one pending request per order. DeliveryEditor / ItemEditor
  // surface their own pending cards; here we render nothing extra so the
  // section doesn't double up on the cross-type note.
  if (changeRequest && reqType !== "address") return null;

  // ── Pending address-change card ──────────────────────────────────────
  if (changeRequest && reqType === "address" && !editing) {
    const from = String(order.delivery_address ?? "—");
    const to = String(changeRequest.requested_delivery_address ?? "");
    return (
      <div
        style={{
          marginTop: 16,
          padding: "16px 18px",
          border: "1px solid #024628",
          background: "#FBF3D4",
          borderRadius: 4,
        }}
      >
        <p
          style={{
            margin: "0 0 12px",
            fontFamily: "var(--font-body)",
            fontSize: 11,
            fontWeight: 400,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "#024628",
          }}
        >
          Address change requested · awaiting approval
        </p>
        <p
          style={{
            margin: "0 0 6px",
            fontFamily: "var(--font-body)",
            fontSize: 10,
            fontWeight: 200,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "rgba(2,70,40,0.6)",
          }}
        >
          Address
        </p>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-body)",
            fontSize: 14,
            fontWeight: 200,
            color: "#024628",
            lineHeight: 1.6,
          }}
        >
          <span style={{ color: "rgba(2,70,40,0.6)", textDecoration: "line-through" }}>
            {from}
          </span>
          <br />
          <span style={{ color: "#024628" }}>{to}</span>
        </p>
        {changeRequest.reason && (
          <p
            style={{
              margin: "10px 0 0",
              fontFamily: "var(--font-body)",
              fontSize: 12,
              fontWeight: 200,
              fontStyle: "italic",
              color: "rgba(2,70,40,0.7)",
              lineHeight: 1.6,
            }}
          >
            “{changeRequest.reason}”
          </p>
        )}
        {err && (
          <p style={{ margin: "10px 0 0", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "#991B1B" }}>
            {err}
          </p>
        )}
        <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={cancelRequest}
            disabled={busy}
            style={{
              height: 40,
              padding: "0 18px",
              background: "transparent",
              border: "1px solid rgba(255,129,129,0.4)",
              cursor: busy ? "default" : "pointer",
              fontFamily: "var(--font-body)",
              fontSize: 10,
              fontWeight: 300,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "#991B1B",
            }}
          >
            {busy ? "Cancelling…" : "Cancel request"}
          </button>
          <button
            type="button"
            onClick={openForm}
            disabled={busy}
            style={{
              height: 40,
              padding: "0 18px",
              background: "transparent",
              border: "1px solid rgba(2,70,40,0.25)",
              cursor: busy ? "default" : "pointer",
              fontFamily: "var(--font-body)",
              fontSize: 10,
              fontWeight: 300,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "rgba(2,70,40,0.75)",
            }}
          >
            Edit again
          </button>
        </div>
      </div>
    );
  }

  // ── Trigger button (no pending request, not yet editing) ─────────────
  if (!editing) {
    return (
      <div style={{ marginTop: 10 }}>
        <button
          type="button"
          onClick={openForm}
          style={{
            height: 40,
            padding: "0 18px",
            background: "transparent",
            border: "1px solid rgba(2,70,40,0.25)",
            cursor: "pointer",
            fontFamily: "var(--font-body)",
            fontSize: 10,
            fontWeight: 300,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "rgba(2,70,40,0.8)",
          }}
        >
          Edit address
        </button>
      </div>
    );
  }

  // ── Inline edit form ─────────────────────────────────────────────────
  return (
    <div
      style={{
        marginTop: 16,
        padding: "18px",
        border: "1px solid rgba(2,70,40,0.2)",
        borderRadius: 4,
      }}
    >
      <p
        style={{
          margin: "0 0 16px",
          fontFamily: "var(--font-body)",
          fontSize: 12,
          fontWeight: 200,
          lineHeight: 1.6,
          color: "rgba(2,70,40,0.7)",
        }}
      >
        Request a change to your delivery address. Your order stays as-is
        until we approve it.
      </p>

      <p style={{ ...editorLabel }}>Address</p>
      <textarea
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        rows={3}
        placeholder="Door no, street, area, city, pincode"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "10px 12px",
          marginBottom: 16,
          background: "#FBF3D4",
          border: "1px solid #024628",
          color: "#024628",
          caretColor: "#024628",
          fontFamily: "var(--font-body)",
          fontSize: 14,
          fontWeight: 200,
          resize: "vertical",
        }}
      />

      <p style={{ ...editorLabel }}>Reason (optional)</p>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why are you changing this?"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "10px 12px",
          marginBottom: 16,
          background: "#FBF3D4",
          border: "1px solid #024628",
          color: "#024628",
          caretColor: "#024628",
          fontFamily: "var(--font-body)",
          fontSize: 14,
          fontWeight: 200,
        }}
      />

      {err && (
        <p style={{ margin: "0 0 12px", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "#991B1B", lineHeight: 1.6 }}>
          {err}
        </p>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          style={{
            height: 44,
            padding: "0 24px",
            background: busy ? "rgba(245,158,11,0.5)" : "#f59e0b",
            border: "none",
            cursor: busy ? "default" : "pointer",
            fontFamily: "var(--font-body)",
            fontSize: 11,
            fontWeight: 400,
            letterSpacing: "0.35em",
            textTransform: "uppercase",
            color: "#024628",
          }}
        >
          {busy ? "Sending…" : "Send request"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setErr(null);
          }}
          disabled={busy}
          style={{
            height: 44,
            padding: "0 20px",
            background: "transparent",
            border: "1px solid rgba(2,70,40,0.25)",
            cursor: busy ? "default" : "pointer",
            fontFamily: "var(--font-body)",
            fontSize: 11,
            fontWeight: 300,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "rgba(2,70,40,0.75)",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function qtyButton(disabled: boolean): React.CSSProperties {
  return {
    width: 32,
    height: 32,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    border: "1px solid rgba(2,70,40,0.25)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.3 : 1,
    fontFamily: "var(--font-body)",
    fontSize: 18,
    fontWeight: 300,
    color: "#024628",
    lineHeight: 1,
  };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 16,
        padding: "8px 0",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: 11,
          fontWeight: 200,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          color: "rgba(2,70,40,0.6)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: 14,
          fontWeight: 200,
          color: "#024628",
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}
