"use client";

// Success landing after place_order completes. The /checkout route pushes
// to here with `?order=<shortId>&id=<uuid>` after clearing the cart.
//
// We render the celebration animation, the order id, a summary of items +
// delivery slot + fee + total (fetched from /api/orders/<id>), and a
// "Track order" button into /orders/<id>.

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { trackPurchase } from "@/lib/analytics";

const GRAIN = "url(/grain.svg)";

type OrderItem = {
  name: string;
  qty: number;
  line_total?: number;
  price_inr?: number;
};

type Order = {
  id: string;
  total_amount: number;
  delivery_fee: number | null;
  delivery_date: string | null;
  delivery_slot: string | null;
  items: OrderItem[] | null;
};

function formatDeliveryDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatSlot(slot: string | null): string {
  if (!slot) return "";
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

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={null}>
      <SuccessInner />
    </Suspense>
  );
}

function SuccessInner() {
  const router = useRouter();
  const params = useSearchParams();
  const orderShort = (params.get("order") || "").toUpperCase();
  const orderId = params.get("id") || "";
  const [animated, setAnimated] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const purchaseTrackedRef = useRef(false);

  useEffect(() => {
    const t = window.setTimeout(() => setAnimated(true), 50);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    // If somebody deep-links here without an order id, bounce to /shop
    // rather than show a blank confirmation page.
    if (!params.get("order")) {
      router.replace("/shop");
    }
  }, [params, router]);

  // Fetch the just-placed order so we can show items / slot / total.
  // The cdx_phone_verified cookie is freshly set by place_order so this
  // request will be authorised. If it 401s (verify expired between
  // place_order and this fetch) we just fall back to the minimal layout.
  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
          cache: "no-store",
          credentials: "include",
        });
        if (!r.ok) return;
        const data = (await r.json()) as { order?: Order };
        if (!cancelled && data.order && typeof data.order === "object") {
          setOrder(data.order);
        }
      } catch {
        /* fall back to the minimal layout */
      }
    })();
    return () => { cancelled = true; };
  }, [orderId]);

  // GA4 purchase — fire exactly once per order. The ref guards re-renders
  // within this mount; the sessionStorage key guards a page refresh so a
  // reload of the confirmation URL doesn't double-count the transaction.
  useEffect(() => {
    if (purchaseTrackedRef.current || !order) return;
    const transactionId = orderShort || orderId;
    if (!transactionId) return;
    const storageKey = `cdx_ga_purchase_${transactionId}`;
    try {
      if (sessionStorage.getItem(storageKey)) {
        purchaseTrackedRef.current = true;
        return;
      }
    } catch {
      /* private mode / storage disabled — fall through and still fire once */
    }
    purchaseTrackedRef.current = true;
    trackPurchase({
      transactionId,
      value: order.total_amount,
      items: Array.isArray(order.items)
        ? order.items.map((it) => ({
            item_name: it.name,
            quantity: it.qty,
            price: it.price_inr ?? (it.qty ? (it.line_total ?? 0) / it.qty : undefined),
          }))
        : [],
    });
    try {
      sessionStorage.setItem(storageKey, "1");
    } catch {
      /* ignore */
    }
  }, [order, orderShort, orderId]);

  const subtotal =
    order && Array.isArray(order.items)
      ? order.items.reduce((sum, it) => {
          const line = it.line_total ?? (it.price_inr ?? 0) * (it.qty ?? 0);
          return sum + (line || 0);
        }, 0)
      : 0;

  return (
    <div style={{ minHeight: "100dvh", background: "#C0C8CE", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.05, pointerEvents: "none", zIndex: 0 }} />

      <main
        style={{
          position: "relative", zIndex: 1,
          maxWidth: 640, margin: "0 auto",
          minHeight: "100dvh",
          padding: "60px 24px 140px",
          display: "flex", flexDirection: "column", alignItems: "center",
          textAlign: "center",
        }}
      >
        <svg width="84" height="84" viewBox="0 0 72 72" style={{ marginBottom: 26, marginTop: 24 }}>
          <circle
            cx="36" cy="36" r="34"
            fill="none" stroke="#024628" strokeWidth="2"
            strokeDasharray="220"
            strokeDashoffset={animated ? 0 : 220}
            style={{ transition: "stroke-dashoffset 0.5s ease" }}
          />
          <polyline
            points="22,37 32,47 52,26"
            fill="none" stroke="#024628" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray="80"
            strokeDashoffset={animated ? 0 : 80}
            style={{ transition: "stroke-dashoffset 0.45s 0.35s ease, opacity 0.45s 0.35s ease", opacity: animated ? 1 : 0 }}
          />
        </svg>

        <p
          style={{
            margin: "0 0 12px",
            fontFamily: "var(--font-heading)", fontSize: "clamp(34px,8vw,52px)",
            fontWeight: 300, color: "#024628", letterSpacing: "0.06em", lineHeight: 1.05,
          }}
        >
          Order Confirmed
        </p>
        {orderShort && (
          <p
            style={{
              margin: "0 0 10px",
              fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200,
              letterSpacing: "0.35em", textTransform: "uppercase",
              color: "rgba(2,70,40,0.7)",
            }}
          >
            Order #{orderShort}
          </p>
        )}
        <p
          style={{
            margin: "0 0 28px", maxWidth: 380,
            fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200,
            letterSpacing: "0.05em", color: "rgba(2,70,40,0.7)", lineHeight: 1.7,
          }}
        >
          Thank you. We&apos;ve sent a confirmation to your phone and will reach out to finalise delivery.
        </p>

        {/* Order summary card — fades in once /api/orders/<id> resolves. */}
        {order && (
          <div
            style={{
              width: "100%", maxWidth: 460,
              border: "1px solid rgba(2,70,40,0.2)",
              padding: "20px 22px",
              marginBottom: 28,
              textAlign: "left",
            }}
          >
            {(order.delivery_date || order.delivery_slot) && (
              <div style={{ marginBottom: 18 }}>
                <p style={summaryHeading}>Delivery</p>
                <p style={summaryValue}>
                  {[formatDeliveryDate(order.delivery_date), formatSlot(order.delivery_slot)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            )}

            {Array.isArray(order.items) && order.items.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <p style={summaryHeading}>Items</p>
                {order.items.map((it, idx) => (
                  <div
                    key={`${it.name}-${idx}`}
                    style={{
                      display: "flex", justifyContent: "space-between",
                      gap: 12, padding: "6px 0",
                      borderBottom: idx === order.items!.length - 1 ? "none" : "1px solid rgba(2,70,40,0.12)",
                    }}
                  >
                    <span style={{ ...summaryValue, color: "rgba(2,70,40,0.75)" }}>
                      {it.name} × {it.qty}
                    </span>
                    <span style={{ ...summaryValue, color: "rgba(2,70,40,0.75)" }}>
                      ₹{(it.line_total ?? (it.price_inr ?? 0) * (it.qty ?? 0)).toLocaleString("en-IN")}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ borderTop: "1px solid rgba(2,70,40,0.2)", paddingTop: 12 }}>
              <SummaryRow label="Subtotal" value={`₹${subtotal.toLocaleString("en-IN")}`} />
              {typeof order.delivery_fee === "number" && order.delivery_fee > 0 && (
                <SummaryRow
                  label="Delivery"
                  value={`₹${order.delivery_fee.toLocaleString("en-IN")}`}
                />
              )}
              <SummaryRow
                label="Total"
                value={`₹${order.total_amount.toLocaleString("en-IN")}`}
                strong
              />
            </div>
          </div>
        )}

        <Link
          href={orderId ? `/orders/${encodeURIComponent(orderId)}` : "/orders"}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "100%", maxWidth: 360, height: 56,
            background: "#f59e0b",
            textDecoration: "none",
            fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 400,
            letterSpacing: "0.4em", textTransform: "uppercase",
            color: "#024628",
            marginBottom: 14,
            WebkitTapHighlightColor: "transparent",
          }}
        >
          Track Order
        </Link>
        <Link
          href="/shop"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "100%", maxWidth: 360, height: 48,
            background: "transparent",
            border: "1px solid rgba(2,70,40,0.25)",
            textDecoration: "none",
            fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
            letterSpacing: "0.4em", textTransform: "uppercase",
            color: "rgba(2,70,40,0.7)",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          Continue Shopping
        </Link>
      </main>
    </div>
  );
}

const summaryHeading: React.CSSProperties = {
  margin: "0 0 6px",
  fontFamily: "var(--font-body)",
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: "0.35em",
  textTransform: "uppercase",
  color: "rgba(2,70,40,0.7)",
};

const summaryValue: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-body)",
  fontSize: 13,
  fontWeight: 300,
  color: "rgba(2,70,40,0.85)",
  letterSpacing: "0.03em",
  lineHeight: 1.5,
};

function SummaryRow(props: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: props.strong ? 12 : 11,
          fontWeight: props.strong ? 400 : 300,
          letterSpacing: props.strong ? "0.3em" : "0.05em",
          textTransform: props.strong ? "uppercase" : "none",
          color: props.strong ? "#024628" : "rgba(2,70,40,0.7)",
        }}
      >
        {props.label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: props.strong ? 13 : 12,
          fontWeight: props.strong ? 400 : 300,
          color: props.strong ? "#024628" : "rgba(2,70,40,0.75)",
          letterSpacing: "0.03em",
        }}
      >
        {props.value}
      </span>
    </div>
  );
}
