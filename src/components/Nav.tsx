"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

const GRAIN = "url(/grain.svg)";

/* ── Nav ── */
export default function Nav() {
  const router = useRouter();
  const pathname = usePathname();
  const isHome = pathname === "/";

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

  // Listen for left-edge swipe → open menu (dispatched by EdgeSwipeNav).
  // Only acts on home, where the hamburger lives.
  useEffect(() => {
    if (!isHome) return;
    const open = () => setMenuOpen(true);
    window.addEventListener("cadieux:open-menu", open);
    return () => window.removeEventListener("cadieux:open-menu", open);
  }, [isHome]);

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
            position: "fixed",
            // Sit below the iOS notch / Dynamic Island in PWA standalone mode.
            top: "max(20px, env(safe-area-inset-top))",
            left: "max(20px, env(safe-area-inset-left))",
            zIndex: 210,
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
      {/* The drawer is split into a sticky header (the "Menu" caption,
          which sits below the hamburger button) and an independently
          scrollable nav body. This guarantees every link is reachable
          on small viewports (iPhone SE @ 375x667) even as the nav
          grows. -webkit-overflow-scrolling:touch keeps iOS scroll
          momentum smooth inside the fixed drawer. */}
      <div style={{
        position: "fixed", top: 0, left: 0, zIndex: 205,
        width: "min(360px, 92vw)", height: "100dvh", maxHeight: "100dvh",
        background: "#0a0a0a",
        transform: menuOpen ? "translateX(0)" : "translateX(-100%)",
        transition: "transform 0.45s cubic-bezier(0.22,1,0.36,1)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, opacity: 0.05, pointerEvents: "none" }} />

        {/* Sticky header — sits at top, never scrolls. Leaves room for
            the hamburger button overlay (positioned at top:20px). */}
        <div style={{
          position: "relative", zIndex: 1,
          padding: "calc(100px + env(safe-area-inset-top)) calc(28px + env(safe-area-inset-right)) 24px calc(28px + env(safe-area-inset-left))",
          flexShrink: 0,
        }}>
          <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, letterSpacing: "0.5em", textTransform: "uppercase", color: "rgba(200,144,58,0.55)" }}>Menu</p>
        </div>

        {/* Scrollable nav body — everything below the sticky header. */}
        <div style={{
          position: "relative", zIndex: 1,
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
          padding: "0 calc(28px + env(safe-area-inset-right)) calc(28px + env(safe-area-inset-bottom)) calc(28px + env(safe-area-inset-left))",
          display: "flex", flexDirection: "column",
        }}>
          {[
            { label: "Products of Cadieux", action: () => nav("/shop") },
            { label: "Orders",              action: () => nav("/orders") },
            { label: "Cart",                action: () => nav("/cart") },
            { label: "Subscription",        action: () => nav("/subscription") },
            { label: "How We Bake",         action: () => nav("/making") },
            { label: "Blogs",               action: () => nav("/blogs") },
            { label: "Feedback & Reviews",  action: () => nav("/feedback") },
            { label: "Reports",             action: () => nav("/reports") },
            { label: "Store Locator",       action: () => nav("/find-us") },
            { label: "Connect with Cadieux", action: () => nav("/connect") },
          ].map(({ label, action }) => (
            <button key={label} onClick={action} style={{
              background: "none", border: "none", cursor: "pointer", padding: "12px 0",
              textAlign: "left", borderBottom: "1px solid rgba(240,223,200,0.06)",
              fontFamily: "var(--font-heading)", fontSize: "clamp(16px,2.6vw,20px)", fontWeight: 300,
              color: "#FBF3D4", letterSpacing: "0.03em",
              display: "block", width: "100%",
              flexShrink: 0,
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

    </>
  );
}
