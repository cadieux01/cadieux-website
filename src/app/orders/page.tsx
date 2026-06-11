"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const GRAIN = "url(/grain.svg)";

type RawOrder = {
  id: string;
  total_amount: number;
  delivery_address: string;
  status: string;
  created_at: string;
};

type RawSub = {
  id: string;
  product_name: string | null;
  total_amount: number;
  status: string;
  created_at: string;
  customer_address: string | null;
  customer_city: string | null;
};

type Row = {
  id: string;
  type: "order" | "subscription";
  total: number;
  description: string;
  status: string;
  created_at: string;
  href: string | null;
};

function buildRows(orders: RawOrder[], subs: RawSub[]): Row[] {
  const orderRows: Row[] = orders.map((o) => ({
    id: `o:${o.id}`,
    type: "order",
    total: Number(o.total_amount),
    description: o.delivery_address,
    status: o.status,
    created_at: o.created_at,
    href: `/orders/${encodeURIComponent(o.id)}`,
  }));

  const subRows: Row[] = subs.map((s) => {
    const status = (s.status || "").toLowerCase();
    const isActive = status !== "completed" && status !== "cancelled";
    const addr = [s.customer_address, s.customer_city].filter(Boolean).join(", ");
    const desc = [s.product_name ?? "Subscription", addr].filter(Boolean).join(" — ");
    // Per-subscription detail page doesn't exist yet (the [deliveryId] route
    // owns /subscriptions/track/<uuid>). Active subs land on the live
    // tracker; finished ones land on the history page where they're listed.
    const href = isActive ? "/subscriptions/track" : "/subscriptions/past";
    return {
      id: `s:${s.id}`,
      type: "subscription",
      total: Number(s.total_amount),
      description: desc || "Subscription",
      status: s.status,
      created_at: s.created_at,
      href,
    };
  });

  return [...orderRows, ...subRows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export default function OrdersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [phoneMissing, setPhoneMissing] = useState(false);

  const fetchOrders = useCallback(async (showLoading: boolean) => {
    const phone = typeof window !== "undefined" ? localStorage.getItem("cadieux_phone") : null;
    if (!phone) { setPhoneMissing(true); return; }
    setPhoneMissing(false);
    if (showLoading) setLoading(true);
    try {
      const r = await fetch(`/api/checkout?phone=${encodeURIComponent(phone)}`, { cache: "no-store" });
      const d = await r.json();
      setRows(buildRows(d.orders ?? [], d.subscriptions ?? []));
    } catch { /* ignore */ }
    finally { if (showLoading) setLoading(false); }
  }, []);

  // Initial load + live refresh: poll every 20s and refetch on focus /
  // visibility so dashboard status changes appear without a manual reload.
  // Background refreshes are silent (no loading spinner).
  useEffect(() => {
    fetchOrders(true);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") fetchOrders(false);
    }, 20000);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchOrders(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [fetchOrders]);

  return (
    <div style={{ minHeight: "100dvh", background: "rgb(6,4,2)", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />

      <Link href="/" style={{
        position: "fixed", top: "calc(24px + env(safe-area-inset-top))", left: "calc(20px + env(safe-area-inset-left))", zIndex: 101,
        fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
        letterSpacing: "0.35em", textTransform: "uppercase",
        color: "#4369B2", textDecoration: "none",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>←</span> Cadieux
      </Link>

      <div style={{ position: "relative", zIndex: 1, padding: "100px clamp(24px,6vw,80px) 120px", maxWidth: 720, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-heading)", fontSize: "clamp(48px,11vw,88px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1 }}>
            Orders
          </h1>
          <button onClick={() => fetchOrders(true)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(200,144,58,0.65)", WebkitTapHighlightColor: "transparent" }}>↻ Refresh</button>
        </div>
        <p style={{ margin: "0 0 36px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(251,243,212,0.5)" }}>
          One-time orders & subscriptions
        </p>

        {loading && rows.length === 0 && (
          <p style={{ fontFamily: "var(--font-body)", fontSize: 15, color: "rgba(240,223,200,0.3)", letterSpacing: "0.1em" }}>Loading…</p>
        )}
        {phoneMissing && (
          <p style={{ fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 200, color: "rgba(240,223,200,0.4)", lineHeight: 1.7 }}>Place an order from the cart first — we look up your orders by phone number.</p>
        )}
        {!loading && !phoneMissing && rows.length === 0 && (
          <p style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "rgba(240,223,200,0.35)", lineHeight: 1.7 }}>No orders yet. Add something to your cart to get started.</p>
        )}

        {rows.map((row, i) => (
          <OrderRow key={row.id} row={row} number={rows.length - i} />
        ))}
      </div>
    </div>
  );
}

function OrderRow({ row, number }: { row: Row; number: number }) {
  const isSub = row.type === "subscription";
  const typeLabel = isSub ? "Subscription" : "One-time";
  const status = (row.status || "").toLowerCase();
  const statusColor =
    status === "delivered" || status === "completed"
      ? "rgba(74,222,128,0.7)"
      : status === "cancelled"
        ? "#ff8181"
        : "rgba(200,144,58,0.6)";

  const inner = (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, alignItems: "center", gap: 12 }}>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(200,144,58,0.7)" }}>
          #{String(number).padStart(6, "0")}
        </span>
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 10,
            fontWeight: 300,
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            padding: "3px 9px",
            borderRadius: 999,
            border: `1px solid ${isSub ? "rgba(201,169,110,0.55)" : "rgba(240,223,200,0.18)"}`,
            color: isSub ? "rgba(201,169,110,0.95)" : "rgba(240,223,200,0.55)",
          }}
        >
          {typeLabel}
        </span>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 200, color: "#FBF3D4" }}>
          ₹{Number(row.total).toLocaleString("en-IN")}
        </span>
      </div>
      <p style={{ margin: "0 0 4px", fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 200, color: "rgba(240,223,200,0.5)", letterSpacing: "0.02em" }}>
        {row.description}
      </p>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: statusColor }}>
          {row.status}
        </span>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, color: "rgba(240,223,200,0.25)" }}>
          {new Date(row.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
        </span>
      </div>
    </>
  );

  const wrapStyle: React.CSSProperties = {
    borderBottom: "1px solid rgba(240,223,200,0.07)",
    padding: "14px 0",
    display: "block",
    color: "inherit",
    textDecoration: "none",
    cursor: row.href ? "pointer" : "default",
  };

  if (row.href) {
    return (
      <Link href={row.href} style={wrapStyle}>
        {inner}
      </Link>
    );
  }
  return <div style={wrapStyle}>{inner}</div>;
}
