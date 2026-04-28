"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import CheckoutModal from "./CheckoutModal";
import { useCart } from "@/context/CartContext";

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/* ── Nav ── */
export default function Nav() {
  const router = useRouter();
  const pathname = usePathname();
  const isHome = pathname === "/";

  const {
    cart, cartTotal,
    clearCart,
    checkoutOpen, closeCheckout,
  } = useCart();

  const [menuOpen, setMenuOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Restore menu state from localStorage on mount — so reload keeps the menu open
  useEffect(() => {
    try {
      const savedOpen = localStorage.getItem("cadieux_menu_open");
      if (savedOpen === "1" && isHome) setMenuOpen(true);
    } catch { /* ignore */ }
    setHydrated(true);
  }, [isHome]);

  // Persist menu state
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem("cadieux_menu_open", menuOpen ? "1" : "0");
    } catch { /* ignore */ }
  }, [menuOpen, hydrated]);

  function nav(path: string) {
    setMenuOpen(false);
    router.push(path);
  }

  function openMenu() {
    setMenuOpen(true);
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
        <div style={{ position: "relative", zIndex: 1, padding: "100px 28px 96px", flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <p style={{ margin: "0 0 40px", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, letterSpacing: "0.5em", textTransform: "uppercase", color: "rgba(200,144,58,0.55)" }}>Menu</p>
          {[
            { label: "Products of Cadieux", action: () => nav("/shop") },
            { label: "Orders",              action: () => nav("/orders") },
            { label: "Cart",                action: () => nav("/cart") },
            { label: "Subscription",        action: () => nav("/subscription") },
            { label: "How We Bake",         action: () => nav("/making") },
            { label: "Blogs",               action: () => nav("/blogs") },
            { label: "Feedback & Reviews",  action: () => nav("/feedback") },
            { label: "Reports",             action: () => nav("/reports") },
            { label: "Store Locator",       action: () => nav("/store-locator") },
            { label: "Connect with Cadieux", action: () => nav("/connect") },
          ].map(({ label, action }) => (
            <button key={label} onClick={action} style={{
              background: "none", border: "none", cursor: "pointer", padding: "12px 0",
              textAlign: "left", borderBottom: "1px solid rgba(240,223,200,0.06)",
              fontFamily: "var(--font-heading)", fontSize: "clamp(16px,2.6vw,20px)", fontWeight: 300,
              color: "#FBF3D4", letterSpacing: "0.03em",
              display: "block", width: "100%",
              WebkitTapHighlightColor: "transparent",
            }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Menu backdrop */}
      {menuOpen && (
        <div onClick={() => setMenuOpen(false)} style={{
          position: "fixed", inset: 0, zIndex: 204,
          background: "rgba(0,0,0,0.55)",
        }} />
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
          }}
        />
      )}
    </>
  );
}
