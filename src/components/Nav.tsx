"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import CheckoutModal from "./CheckoutModal";
import { useCart } from "@/context/CartContext";

type Order = {
  id: string;
  total_amount: number;
  delivery_address: string;
  status: string;
  created_at: string;
};

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/* ── Nav ── */
export default function Nav() {
  const router = useRouter();
  const pathname = usePathname();
  const isHome = pathname === "/";

  const {
    cart, cartTotal, cartCount,
    clearCart,
    checkoutOpen, openCheckout, closeCheckout,
  } = useCart();

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuSection, setMenuSection] = useState<"main" | "orders" | "subscription" | "connect">("main");
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Restore menu state from localStorage on mount — so reload keeps the menu open
  useEffect(() => {
    try {
      const savedOpen = localStorage.getItem("cadieux_menu_open");
      const savedSection = localStorage.getItem("cadieux_menu_section");
      if (savedOpen === "1" && isHome) setMenuOpen(true);
      if (savedSection === "main" || savedSection === "orders" || savedSection === "subscription" || savedSection === "connect") {
        setMenuSection(savedSection);
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, [isHome]);

  // Persist menu state
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem("cadieux_menu_open", menuOpen ? "1" : "0");
      localStorage.setItem("cadieux_menu_section", menuSection);
    } catch { /* ignore */ }
  }, [menuOpen, menuSection, hydrated]);

  // Fetch orders (used on mount + when opening orders section)
  const fetchOrders = useCallback(async (showLoading: boolean) => {
    const phone = typeof window !== "undefined" ? localStorage.getItem("cadieux_phone") : null;
    if (!phone) return;
    if (showLoading) setOrdersLoading(true);
    try {
      const r = await fetch(`/api/checkout?phone=${encodeURIComponent(phone)}`, { cache: "no-store" });
      const d = await r.json();
      setOrders(d.orders ?? []);
    } catch {
      /* ignore */
    } finally {
      if (showLoading) setOrdersLoading(false);
    }
  }, []);

  // Pre-fetch orders on mount so "Your Orders" is instant
  useEffect(() => {
    fetchOrders(false);
  }, [fetchOrders]);

  // Refresh orders after checkout closes (new order placed)
  useEffect(() => {
    if (!checkoutOpen) fetchOrders(false);
  }, [checkoutOpen, fetchOrders]);

  function openMenu() {
    setMenuOpen(true);
    setMenuSection("main");
    // Refresh in background — orders already cached from mount/prior opens
    fetchOrders(orders.length === 0);
  }

  // Refresh orders if menu was restored already on "orders" section
  useEffect(() => {
    if (hydrated && menuOpen && menuSection === "orders") {
      fetchOrders(orders.length === 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  function nav(path: string) {
    setMenuOpen(false);
    router.push(path);
  }

  return (
    <>
      <style>{`
        input::placeholder { color: rgba(67,105,178,0.5); }
      `}</style>

      {/* ── Hamburger button (home only) ── */}
      {isHome && (
        <button
          onClick={menuOpen ? () => setMenuOpen(false) : openMenu}
          style={{
            position: "fixed", top: 20, left: 20, zIndex: 210,
            background: "none", border: "none", cursor: "pointer", padding: 8,
            display: "flex", flexDirection: "column", gap: 7,
            WebkitTapHighlightColor: "transparent",
          }}
          aria-label="Menu"
        >
          {[0, 1, 2].map(i => (
            <span key={i} style={{
              display: "block", width: 32, height: 2,
              background: menuOpen ? "rgba(240,223,200,0.6)" : "rgba(240,223,200,0.45)",
              transition: "background 0.3s",
            }} />
          ))}
        </button>
      )}

      {/* ── Menu widget ── */}
      <div style={{
        position: "fixed", top: 0, left: 0, zIndex: 205,
        width: "min(360px, 92vw)", height: "100dvh",
        background: "#0a0a0a",
        transform: menuOpen ? "translateX(0)" : "translateX(-100%)",
        transition: "transform 0.45s cubic-bezier(0.22,1,0.36,1)",
        overflowY: "auto", overscrollBehavior: "contain",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, opacity: 0.05, pointerEvents: "none" }} />
        <div style={{ position: "relative", zIndex: 1, padding: "72px 28px 48px", flex: 1, display: "flex", flexDirection: "column" }}>

          {menuSection === "main" && (
            <>
              <p style={{ margin: "0 0 40px", fontFamily: "var(--font-body)", fontSize: 8, fontWeight: 200, letterSpacing: "0.5em", textTransform: "uppercase", color: "rgba(200,144,58,0.55)" }}>Menu</p>
              {[
                { label: "Explore Cadieux", action: () => nav("/shop") },
                { label: "Your Cart",       action: () => nav("/cart") },
                { label: "Blogs",           action: () => nav("/blogs") },
                { label: "Making",          action: () => nav("/making") },
                { label: "Store Locator",   action: () => nav("/store-locator") },
                { label: "Subscription",    action: () => setMenuSection("subscription") },
                { label: "Your Orders",     action: () => { setMenuSection("orders"); fetchOrders(orders.length === 0); } },
                { label: "Connect With Us", action: () => setMenuSection("connect") },
              ].map(({ label, action }) => (
                <button key={label} onClick={action} style={{
                  background: "none", border: "none", cursor: "pointer", padding: "18px 0",
                  textAlign: "left", borderBottom: "1px solid rgba(240,223,200,0.06)",
                  fontFamily: "var(--font-heading)", fontSize: "clamp(22px,5vw,32px)", fontWeight: 300,
                  color: "#FBF3D4", letterSpacing: "0.03em",
                  display: "block", width: "100%",
                  WebkitTapHighlightColor: "transparent",
                }}>
                  {label}
                </button>
              ))}
            </>
          )}

          {/* ── Your Orders ── */}
          {menuSection === "orders" && (
            <>
              <button onClick={() => setMenuSection("main")} style={{ background: "none", border: "none", cursor: "pointer", padding: "0 0 28px", textAlign: "left", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(200,144,58,0.6)", WebkitTapHighlightColor: "transparent" }}>← Back</button>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <p style={{ margin: 0, fontFamily: "var(--font-heading)", fontSize: 26, fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.04em" }}>Your Orders</p>
                <button onClick={() => fetchOrders(true)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(200,144,58,0.6)", WebkitTapHighlightColor: "transparent" }}>↻ Refresh</button>
              </div>
              {ordersLoading && orders.length === 0 && <p style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "rgba(240,223,200,0.3)", letterSpacing: "0.1em" }}>Loading…</p>}
              {!ordersLoading && orders.length === 0 && (
                <p style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "rgba(240,223,200,0.35)", lineHeight: 1.7 }}>No orders yet. Add something to your cart to get started.</p>
              )}
              {orders.map((o, i) => (
                <div key={o.id} style={{ borderBottom: "1px solid rgba(240,223,200,0.07)", padding: "14px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(200,144,58,0.7)" }}>#{String(orders.length - i).padStart(6, "0")}</span>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, color: "#FBF3D4" }}>₹{o.total_amount}</span>
                  </div>
                  <p style={{ margin: "0 0 4px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, color: "rgba(240,223,200,0.5)", letterSpacing: "0.02em" }}>{o.delivery_address}</p>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: o.status === "pending" ? "rgba(200,144,58,0.6)" : "rgba(74,222,128,0.7)" }}>{o.status}</span>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, color: "rgba(240,223,200,0.25)" }}>{new Date(o.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* ── Subscription ── */}
          {menuSection === "subscription" && (
            <>
              <button onClick={() => setMenuSection("main")} style={{ background: "none", border: "none", cursor: "pointer", padding: "0 0 28px", textAlign: "left", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(200,144,58,0.6)", WebkitTapHighlightColor: "transparent" }}>← Back</button>
              <p style={{ margin: "0 0 24px", fontFamily: "var(--font-heading)", fontSize: 26, fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.04em" }}>Subscription</p>
              <p style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "rgba(240,223,200,0.35)", lineHeight: 1.7 }}>Subscription plans coming soon. Use the shop to set up recurring deliveries.</p>
            </>
          )}

          {/* ── Connect With Us ── */}
          {menuSection === "connect" && (
            <>
              <button onClick={() => setMenuSection("main")} style={{ background: "none", border: "none", cursor: "pointer", padding: "0 0 28px", textAlign: "left", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(200,144,58,0.6)", WebkitTapHighlightColor: "transparent" }}>← Back</button>
              <p style={{ margin: "0 0 32px", fontFamily: "var(--font-heading)", fontSize: 26, fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.04em" }}>Connect</p>
              {[
                { label: "Instagram", value: "@cadieux.in",     href: "https://instagram.com/cadieux.in" },
                { label: "WhatsApp",  value: "+91 98765 43210", href: "https://wa.me/919876543210" },
                { label: "Email",     value: "hello@cadieux.in", href: "mailto:hello@cadieux.in" },
                { label: "Phone",     value: "+91 98765 43210", href: "tel:+919876543210" },
              ].map(({ label, value, href }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0", borderBottom: "1px solid rgba(240,223,200,0.06)", textDecoration: "none" }}>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(200,144,58,0.65)" }}>{label}</span>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "rgba(240,223,200,0.7)", letterSpacing: "0.04em" }}>{value}</span>
                </a>
              ))}
            </>
          )}

        </div>
      </div>

      {/* Menu backdrop */}
      {menuOpen && (
        <div onClick={() => setMenuOpen(false)} style={{
          position: "fixed", inset: 0, zIndex: 204,
          background: "rgba(0,0,0,0.55)",
        }} />
      )}

      {/* Cart FAB (home only — sub-pages have their own nav) */}
      {isHome && (
        <button
          onClick={() => router.push("/cart")}
          style={{
            position: "fixed", bottom: 32, right: 28, zIndex: 101,
            width: 56, height: 56, borderRadius: "50%",
            background: cartCount > 0 ? "#024628" : "rgba(2,70,40,0.45)",
            border: cartCount > 0 ? "none" : "1px solid rgba(251,243,212,0.15)",
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: cartCount > 0 ? "0 4px 24px rgba(0,0,0,0.5)" : "0 2px 12px rgba(0,0,0,0.3)",
            WebkitTapHighlightColor: "transparent",
            transition: "transform 0.2s, box-shadow 0.2s, background 0.3s",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.08)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FBF3D4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
            <line x1="3" y1="6" x2="21" y2="6"/>
            <path d="M16 10a4 4 0 0 1-8 0"/>
          </svg>
          {cartCount > 0 && (
            <span style={{
              position: "absolute", top: 4, right: 4,
              background: "#FBF3D4", color: "#024628",
              borderRadius: "50%", width: 18, height: 18,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 600, letterSpacing: 0,
            }}>{cartCount}</span>
          )}
        </button>
      )}

      {/* Checkout modal */}
      {checkoutOpen && (
        <CheckoutModal
          cart={cart}
          total={cartTotal}
          onClose={closeCheckout}
          onOrderPlaced={() => {
            clearCart();
            closeCheckout();
            fetchOrders(false);
          }}
        />
      )}
    </>
  );
}
