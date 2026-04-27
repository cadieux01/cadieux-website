"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

type Order = {
  id: string;
  total_amount: number;
  delivery_address: string;
  status: string;
  created_at: string;
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [phoneMissing, setPhoneMissing] = useState(false);

  async function fetchOrders(showLoading: boolean) {
    const phone = typeof window !== "undefined" ? localStorage.getItem("cadieux_phone") : null;
    if (!phone) { setPhoneMissing(true); return; }
    setPhoneMissing(false);
    if (showLoading) setLoading(true);
    try {
      const r = await fetch(`/api/checkout?phone=${encodeURIComponent(phone)}`, { cache: "no-store" });
      const d = await r.json();
      setOrders(d.orders ?? []);
    } catch { /* ignore */ }
    finally { if (showLoading) setLoading(false); }
  }

  useEffect(() => { fetchOrders(true); }, []);

  return (
    <div style={{ minHeight: "100dvh", background: "rgb(6,4,2)", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />

      <Link href="/" style={{
        position: "fixed", top: 24, left: 20, zIndex: 101,
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
          Your order history
        </p>

        {loading && orders.length === 0 && (
          <p style={{ fontFamily: "var(--font-body)", fontSize: 15, color: "rgba(240,223,200,0.3)", letterSpacing: "0.1em" }}>Loading…</p>
        )}
        {phoneMissing && (
          <p style={{ fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 200, color: "rgba(240,223,200,0.4)", lineHeight: 1.7 }}>Place an order from the cart first — we look up your orders by phone number.</p>
        )}
        {!loading && !phoneMissing && orders.length === 0 && (
          <p style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "rgba(240,223,200,0.35)", lineHeight: 1.7 }}>No orders yet. Add something to your cart to get started.</p>
        )}
        {orders.map((o, i) => (
          <div key={o.id} style={{ borderBottom: "1px solid rgba(240,223,200,0.07)", padding: "14px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(200,144,58,0.7)" }}>#{String(orders.length - i).padStart(6, "0")}</span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 200, color: "#FBF3D4" }}>₹{o.total_amount}</span>
            </div>
            <p style={{ margin: "0 0 4px", fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 200, color: "rgba(240,223,200,0.5)", letterSpacing: "0.02em" }}>{o.delivery_address}</p>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: o.status === "pending" ? "rgba(200,144,58,0.6)" : "rgba(74,222,128,0.7)" }}>{o.status}</span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, color: "rgba(240,223,200,0.25)" }}>{new Date(o.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
