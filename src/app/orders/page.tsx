"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import BackLink from "@/components/BackLink";

const GRAIN = "url(/grain.svg)";

type RawOrder = {
  id: string;
  total_amount: number;
  delivery_address: string;
  status: string;
  created_at: string;
  delivery_date?: string | null;
  is_preorder?: boolean | null;
  scheduled_delivery_date_at?: string | null;
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
  is_preorder?: boolean;
  delivery_date?: string | null;
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
    is_preorder: !!o.is_preorder,
    delivery_date: o.delivery_date ?? null,
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
  // "verify" = the server refused us (401, session expired or never verified).
  // "failed" = the request itself did not produce an answer.
  // Both used to be indistinguishable from "this customer has no orders":
  // the 401 arrived as a 200 with no `orders` key, and a thrown fetch was
  // swallowed by `catch { /* ignore */ }`. Either way `rows` stayed [] and
  // the page said "No orders yet" — to 279 of 536 customers in the 401 case,
  // every one of whom had a history sitting in the database.
  const [error, setError] = useState<"verify" | "failed" | null>(null);
  // Same guard as orders/[id]/page.tsx: once a load has succeeded, a failing
  // background poll must not replace a good list with an error screen.
  const loadedOnceRef = useRef(false);

  const fetchOrders = useCallback(async (showLoading: boolean) => {
    const phone = typeof window !== "undefined" ? localStorage.getItem("cadieux_phone") : null;
    if (!phone) { setPhoneMissing(true); return; }
    setPhoneMissing(false);
    if (showLoading) setLoading(true);
    try {
      const r = await fetch(`/api/checkout?phone=${encodeURIComponent(phone)}`, {
        cache: "no-store",
        credentials: "include",
      });
      // Mirrors orders/[id]/page.tsx:183.
      if (r.status === 401) {
        if (!loadedOnceRef.current) setError("verify");
        return;
      }
      if (!r.ok) {
        if (!loadedOnceRef.current) setError("failed");
        return;
      }
      const d = await r.json();
      setRows(buildRows(d.orders ?? [], d.subscriptions ?? []));
      setError(null);
      loadedOnceRef.current = true;
    } catch {
      if (!loadedOnceRef.current) setError("failed");
    }
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
    <div style={{ minHeight: "100dvh", background: "#C0C8CE", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.04, mixBlendMode: "multiply", pointerEvents: "none", zIndex: 0 }} />

      <BackLink href="/">Cadieux</BackLink>

      <div style={{ position: "relative", zIndex: 1, padding: "100px clamp(24px,6vw,80px) 120px", maxWidth: 720, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-heading)", fontSize: "clamp(48px,11vw,88px)", fontWeight: 300, color: "#024628", letterSpacing: "0.02em", lineHeight: 1 }}>
            Orders
          </h1>
          <button onClick={() => fetchOrders(true)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.35em", textTransform: "uppercase", color: "#024628", WebkitTapHighlightColor: "transparent" }}>↻ Refresh</button>
        </div>
        <p style={{ margin: "0 0 36px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(2,70,40,0.7)" }}>
          One-time orders & subscriptions
        </p>

        {loading && rows.length === 0 && (
          <p style={{ fontFamily: "var(--font-body)", fontSize: 15, color: "rgba(2,70,40,0.6)", letterSpacing: "0.1em" }}>Loading…</p>
        )}
        {phoneMissing && (
          <p style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "rgba(2,70,40,0.7)", lineHeight: 1.7 }}>Place an order from the cart first — we look up your orders by phone number.</p>
        )}
        {!loading && !phoneMissing && error === "verify" && (
          <SessionExpiredNotice onRetry={() => fetchOrders(true)} />
        )}
        {!loading && !phoneMissing && error === "failed" && (
          <p style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "rgba(2,70,40,0.7)", lineHeight: 1.7 }}>
            We couldn’t load your orders just now. This is a connection problem,
            not a missing history — press Refresh above to try again.
          </p>
        )}
        {/* The genuine empty list. Reachable ONLY when the server answered and
            said so: not when it refused us (error === "verify") and not when
            the request failed (error === "failed"). */}
        {!loading && !phoneMissing && !error && rows.length === 0 && (
          <p style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "rgba(2,70,40,0.7)", lineHeight: 1.7 }}>No orders yet. Add something to your cart to get started.</p>
        )}

        {rows.map((row, i) => (
          <OrderRow key={row.id} row={row} number={rows.length - i} />
        ))}
      </div>
    </div>
  );
}

/* PLACEHOLDER — OWNED BY THE MANDATORY LOGIN GATE, NOT BY THIS PAGE.
 *
 * Deliberately one small self-contained component with a single prop so the
 * login-gate work can delete it and drop its own screen in at the one call
 * site above. Do not grow it.
 *
 * It does NOT link anywhere, and that is not an oversight: as of 2026-10-06
 * the only OTP entry on web lives inside /checkout and /subscriptions/setup/
 * checkout, and /checkout bounces an empty cart straight to /cart — so a
 * "verify now" button from here would be a dead end for exactly the customer
 * who needs it. Retry is the only honest action until the gate exists.
 * (orders/[id]/page.tsx:463 sends people HERE for the same reason, so this
 * page cannot send them back there.) */
function SessionExpiredNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div>
      <p style={{ margin: "0 0 10px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.3em", textTransform: "uppercase", color: "#991B1B" }}>
        Session expired
      </p>
      <p style={{ margin: "0 0 20px", fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "rgba(2,70,40,0.7)", lineHeight: 1.7 }}>
        Your orders are safe — we just can’t show them until we know it’s you.
        For your security we ask for your phone number again from time to time.
        Verify it at checkout, or try again if you’ve just done so in another tab.
      </p>
      <button
        onClick={onRetry}
        style={{ height: 48, padding: "0 28px", background: "#f59e0b", border: "none", cursor: "pointer", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.4em", textTransform: "uppercase", color: "#024628", WebkitTapHighlightColor: "transparent" }}
      >
        Try again
      </button>
    </div>
  );
}

function OrderRow({ row, number }: { row: Row; number: number }) {
  const isSub = row.type === "subscription";
  const typeLabel = isSub ? "Subscription" : "One-time";
  const status = (row.status || "").toLowerCase();
  const statusColor =
    status === "delivered" || status === "completed"
      ? "#024628"
      : status === "cancelled"
        ? "#991B1B"
        : "#024628";

  const inner = (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, alignItems: "center", gap: 12 }}>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(2,70,40,0.75)" }}>
          #{String(number).padStart(6, "0")}
        </span>
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            padding: "3px 9px",
            borderRadius: 999,
            border: "1px solid #024628",
            background: isSub ? "#024628" : "transparent",
            color: isSub ? "#FBF3D4" : "#024628",
          }}
        >
          {typeLabel}
        </span>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 400, color: "#024628" }}>
          ₹{Number(row.total).toLocaleString("en-IN")}
        </span>
      </div>
      <p style={{ margin: "0 0 4px", fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 300, color: "rgba(2,70,40,0.8)", letterSpacing: "0.02em" }}>
        {row.description}
      </p>
      {row.is_preorder && (
        <p style={{ margin: "0 0 6px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.2em", textTransform: "uppercase", color: "#024628" }}>
          {row.delivery_date
            ? `Pre-order · Scheduled ${new Date(row.delivery_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
            : "Pre-order · Delivery date TBD — we’ll confirm by SMS + WhatsApp"}
        </p>
      )}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.3em", textTransform: "uppercase", color: statusColor }}>
          {row.status}
        </span>
        <span style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 300, color: "rgba(2,70,40,0.6)" }}>
          {new Date(row.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
        </span>
      </div>
    </>
  );

  const wrapStyle: React.CSSProperties = {
    borderBottom: "1px solid rgba(2,70,40,0.15)",
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
