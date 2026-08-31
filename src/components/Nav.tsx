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
  // Soft "logged-in" signal: the rest of the site treats the presence
  // of `cadieux_phone` in localStorage as proof the user has placed at
  // least one order on this device. We use it here to gate account-only
  // menu entries (e.g. "Your Address") so anonymous visitors don't see
  // links to pages that would just bounce them to the cart anyway.
  const [hasSavedPhone, setHasSavedPhone] = useState(false);

  // Restore menu state from localStorage on mount — so reload keeps the menu open
  useEffect(() => {
    try {
      const savedOpen = localStorage.getItem("cadieux_menu_open");
      if (savedOpen === "1" && isHome) setMenuOpen(true);
    } catch { /* ignore */ }
    try {
      setHasSavedPhone(!!localStorage.getItem("cadieux_phone"));
    } catch { /* ignore */ }
    setHydrated(true);
  }, [isHome]);

  // Re-evaluate saved-phone presence whenever the drawer is opened so
  // the user sees "Your Address" appear immediately after their first
  // order without needing a full reload (localStorage changes from
  // /checkout don't fire a `storage` event in the same tab).
  useEffect(() => {
    if (!menuOpen) return;
    try {
      setHasSavedPhone(!!localStorage.getItem("cadieux_phone"));
    } catch { /* ignore */ }
  }, [menuOpen]);

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
        background: "#C0C8CE",
        borderRight: "1px solid rgba(2,70,40,0.25)",
        transform: menuOpen ? "translateX(0)" : "translateX(-100%)",
        transition: "transform 0.45s cubic-bezier(0.22,1,0.36,1)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, opacity: 0.04, pointerEvents: "none", mixBlendMode: "multiply" }} />

        {/* Sticky header — sits at top, never scrolls. Leaves room for
            the hamburger button overlay (positioned at top:20px). */}
        <div style={{
          position: "relative", zIndex: 1,
          padding: "calc(100px + env(safe-area-inset-top)) calc(28px + env(safe-area-inset-right)) 24px calc(28px + env(safe-area-inset-left))",
          flexShrink: 0,
        }}>
          <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.5em", textTransform: "uppercase", color: "#024628" }}>Menu</p>
        </div>

        {/* Scrollable nav body — everything below the sticky header.
            data-lenis-prevent keeps Lenis from hijacking the wheel here so
            the drawer scrolls natively (smoothly) instead of fighting the
            page-level smooth scroll. */}
        <div data-lenis-prevent style={{
          position: "relative", zIndex: 1,
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
          padding: "0 calc(28px + env(safe-area-inset-right)) calc(28px + env(safe-area-inset-bottom)) calc(28px + env(safe-area-inset-left))",
          display: "flex", flexDirection: "column",
        }}>
          {(() => {
            // Two-group menu: MAIN = transactional / account, EXPLORE = editorial.
            // Account-only entries ("Addresses" / "Requests") sit inside MAIN
            // next to Orders and only appear once the device has placed an
            // order (cadieux_phone in localStorage). Hidden for first-time
            // visitors so we don't dangle a link that just bounces them to
            // the cart.
            const mainItems: { label: string; action: () => void }[] = [
              { label: "Products",       action: () => nav("/shop") },
              { label: "Orders",         action: () => nav("/orders") },
              ...(hasSavedPhone
                ? [
                    { label: "Address",  action: () => nav("/account/addresses") },
                    { label: "Requests", action: () => nav("/account/requests") },
                  ]
                : []),
              { label: "Cart",           action: () => nav("/cart") },
              { label: "Subscription",   action: () => nav("/subscription") },
              { label: "Store Locator",  action: () => nav("/store-locator") },
              { label: "Check Delivery", action: () => nav("/find-us") },
            ];
            const exploreItems: { label: string; action: () => void }[] = [
              { label: "Precision Baking", action: () => nav("/making") },
              { label: "Behind Cadieux",   action: () => nav("/behind-cadieux") },
              { label: "Blogs",            action: () => nav("/blogs") },
              { label: "Reviews",          action: () => nav("/feedback") },
              { label: "Reports",          action: () => nav("/reports") },
              { label: "Connect",          action: () => nav("/connect") },
            ];

            const sectionLabelStyle: React.CSSProperties = {
              margin: "0 0 6px",
              fontFamily: "var(--font-body)",
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: "rgba(2,70,40,0.6)",
              flexShrink: 0,
            };
            const itemStyle: React.CSSProperties = {
              background: "none", border: "none", cursor: "pointer", padding: "12px 0",
              textAlign: "left", borderBottom: "1px solid rgba(2,70,40,0.15)",
              fontFamily: "var(--font-heading)", fontSize: "clamp(16px,2.6vw,20px)", fontWeight: 300,
              color: "#024628", letterSpacing: "0.03em",
              display: "block", width: "100%",
              flexShrink: 0,
              WebkitTapHighlightColor: "transparent",
            };

            return (
              <>
                <p style={sectionLabelStyle}>Main</p>
                {mainItems.map(({ label, action }) => (
                  <button key={label} onClick={action} style={itemStyle}>
                    {label}
                  </button>
                ))}

                <div style={{ height: 1, background: "rgba(2,70,40,0.15)", margin: "24px 0", flexShrink: 0 }} />

                <p style={sectionLabelStyle}>Explore</p>
                {exploreItems.map(({ label, action }) => (
                  <button key={label} onClick={action} style={itemStyle}>
                    {label}
                  </button>
                ))}
              </>
            );
          })()}
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
