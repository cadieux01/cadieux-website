"use client";

// Per-order detail page. Linked from the checkout success screen and
// (eventually) from the /orders list. The user must already have a
// valid cdx_phone_verified cookie matching the order's customer phone,
// otherwise /api/orders/[id] returns 404 and we render an "unavailable"
// state with a path back to /orders (which prompts re-verification).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

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
  delivery_address: string | null;
  items: OrderItem[] | null;
  delivery_date: string | null;
  delivery_slot: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  refund_status: string | null;
};

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

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!id) return;
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/orders/${encodeURIComponent(id)}`, {
          cache: "no-store",
          credentials: "include",
        });
        if (r.status === 401) {
          if (!cancelled) setError("verify");
          return;
        }
        if (!r.ok) {
          if (!cancelled) setError("notfound");
          return;
        }
        const d = await r.json();
        if (!cancelled) setOrder(d.order as Order);
      } catch {
        if (!cancelled) setError("notfound");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [id]);

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

            <h1
              style={{
                margin: "0 0 36px",
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
