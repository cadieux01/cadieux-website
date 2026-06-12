"use client";

// Per-order detail page. Linked from the checkout success screen and
// (eventually) from the /orders list. The user must already have a
// valid cdx_phone_verified cookie matching the order's customer phone,
// otherwise /api/orders/[id] returns 404 and we render an "unavailable"
// state with a path back to /orders (which prompts re-verification).

import { useCallback, useEffect, useRef, useState } from "react";
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
  if (s === "paid") return "rgba(74,222,128,0.85)";
  if (s === "failed") return "#ff8181";
  if (m === "cod") return "rgba(240,223,200,0.85)";
  return "rgba(200,144,58,0.85)";
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
  if (s === "delivered" || s === "completed") return "rgba(74,222,128,0.85)";
  if (s === "cancelled") return "#ff8181";
  if (s === "confirmed" || s === "out_for_delivery") return "rgba(200,144,58,0.95)";
  return "rgba(200,144,58,0.7)";
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = (params?.id || "").toString();

  const [order, setOrder] = useState<Order | null>(null);
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
        background: "rgb(6,4,2)",
        position: "relative",
        overflowX: "clip",
      }}
    >
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundImage: GRAIN,
          opacity: 0.055,
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
          color: "#4369B2",
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
              color: "rgba(240,223,200,0.3)",
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
                color: "#FBF3D4",
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
                color: "rgba(240,223,200,0.55)",
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
                color: "#080604",
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
                color: "#FBF3D4",
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
                color: "rgba(240,223,200,0.55)",
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
                border: "1px solid rgba(240,223,200,0.18)",
                textDecoration: "none",
                fontFamily: "var(--font-body)",
                fontSize: 11,
                fontWeight: 300,
                letterSpacing: "0.4em",
                textTransform: "uppercase",
                color: "rgba(240,223,200,0.6)",
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
                  color: "rgba(200,144,58,0.7)",
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
                  color: "#FBF3D4",
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
                    color: "rgba(240,223,200,0.4)",
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
                      borderBottom: "1px solid rgba(240,223,200,0.06)",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p
                        style={{
                          margin: 0,
                          fontFamily: "var(--font-body)",
                          fontSize: 15,
                          fontWeight: 300,
                          color: "#FBF3D4",
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
                          color: "rgba(240,223,200,0.4)",
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
                        color: "rgba(240,223,200,0.85)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      ₹{Number(line).toLocaleString("en-IN")}
                    </span>
                  </div>
                );
              })}
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
                  borderTop: "1px solid rgba(240,223,200,0.12)",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 11,
                    fontWeight: 300,
                    letterSpacing: "0.35em",
                    textTransform: "uppercase",
                    color: "rgba(240,223,200,0.55)",
                  }}
                >
                  Grand Total
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 22,
                    fontWeight: 300,
                    color: "#FBF3D4",
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
                    color: "rgba(240,223,200,0.4)",
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

              {/* Pay Now — only for unpaid COD orders that aren't cancelled. */}
              {(order.payment_method ?? "").toLowerCase() === "cod" &&
                (order.payment_status ?? "").toLowerCase() !== "paid" &&
                !isCancelled(order.status) && (
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
                        color: "#080604",
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
                          color: "#ff8181",
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
                color: "rgba(240,223,200,0.3)",
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
          color: "rgba(200,144,58,0.7)",
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
            color: "rgba(200,144,58,0.7)",
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
            color: "rgba(240,223,200,0.85)",
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
          color: "rgba(200,144,58,0.7)",
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
          const dotBg = done || active ? "rgba(74,222,128,0.85)" : "transparent";
          const dotBorder = done || active
            ? "rgba(74,222,128,0.85)"
            : "rgba(240,223,200,0.25)";
          const labelColor = active
            ? "#FBF3D4"
            : done
            ? "rgba(240,223,200,0.7)"
            : "rgba(240,223,200,0.35)";
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
                        ? "rgba(74,222,128,0.6)"
                        : "rgba(240,223,200,0.12)",
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
                  color: "#080604",
                  fontFamily: "var(--font-body)",
                  fontSize: 11,
                  fontWeight: 500,
                  lineHeight: 1,
                  boxShadow: active
                    ? "0 0 0 4px rgba(74,222,128,0.15)"
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
            color: "rgba(240,223,200,0.4)",
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
          color: "rgba(240,223,200,0.4)",
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
          color: "rgba(240,223,200,0.85)",
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}
