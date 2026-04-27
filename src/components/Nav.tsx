"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import CheckoutModal from "./CheckoutModal";
import { useCart } from "@/context/CartContext";
import { PRODUCTS, STORES, VIZAG_AREAS } from "@/lib/data";

// Fuzzy match score (higher = better, 0 = no match). Designed for store-locator
// predictability: handles prefix, word-boundary prefix, substring, subsequence,
// and a single-character typo for 4+ char queries.
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const t = target.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 850;
  const words = t.split(/[\s,'\-]+/);
  if (words.some(w => w.startsWith(q))) return 700;
  if (t.includes(q)) return 550;
  // Subsequence match — all chars of q appear in t in order
  let qi = 0, lastHit = -2, consec = 0, maxConsec = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      consec = lastHit === ti - 1 ? consec + 1 : 1;
      if (consec > maxConsec) maxConsec = consec;
      lastHit = ti;
      qi++;
    }
  }
  if (qi === q.length) return 200 + maxConsec * 15;
  // Single-char typo tolerance for queries of 4+ chars
  if (q.length >= 4) {
    for (let i = 0; i < q.length; i++) {
      const sub = q.slice(0, i) + q.slice(i + 1);
      if (t.includes(sub)) return 120;
    }
  }
  return 0;
}

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
    cart, cartTotal,
    clearCart,
    checkoutOpen, openCheckout, closeCheckout,
  } = useCart();

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuSection, setMenuSection] = useState<"main" | "orders" | "subscription" | "connect" | "reports" | "locator">("main");
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Store locator state
  const [locatorSearch, setLocatorSearch] = useState("");
  const [locatorArea, setLocatorArea] = useState<string | null>(null);
  const [locatorStore, setLocatorStore] = useState<string | null>(null);
  const [locatorDropdownOpen, setLocatorDropdownOpen] = useState(false);

  // Restore menu state from localStorage on mount — so reload keeps the menu open
  useEffect(() => {
    try {
      const savedOpen = localStorage.getItem("cadieux_menu_open");
      const savedSection = localStorage.getItem("cadieux_menu_section");
      if (savedOpen === "1" && isHome) setMenuOpen(true);
      if (savedSection === "main" || savedSection === "orders" || savedSection === "subscription" || savedSection === "connect" || savedSection === "reports" || savedSection === "locator") {
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

  // Refresh orders if menu was restored already on "orders" section.
  // fetchOrders is memoised with useCallback above so this is stable.
  useEffect(() => {
    if (hydrated && menuOpen && menuSection === "orders") {
      fetchOrders(orders.length === 0);
    }
  }, [hydrated, menuOpen, menuSection, orders.length, fetchOrders]);

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
        <div style={{ position: "relative", zIndex: 1, padding: "100px 28px 96px", flexShrink: 0, display: "flex", flexDirection: "column" }}>

          {menuSection === "main" && (
            <>
              <p style={{ margin: "0 0 40px", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, letterSpacing: "0.5em", textTransform: "uppercase", color: "rgba(200,144,58,0.55)" }}>Menu</p>
              {[
                { label: "Products of Cadieux", action: () => nav("/shop") },
                { label: "Orders",              action: () => { setMenuSection("orders"); fetchOrders(orders.length === 0); } },
                { label: "Cart",                action: () => nav("/cart") },
                { label: "Subscription",        action: () => setMenuSection("subscription") },
                { label: "How We Bake",         action: () => nav("/making") },
                { label: "Blogs",               action: () => nav("/blogs") },
                { label: "Reports",             action: () => setMenuSection("reports") },
                { label: "Store Locator",       action: () => setMenuSection("locator") },
                { label: "Connect with Cadieux", action: () => setMenuSection("connect") },
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
            </>
          )}

          {/* ── Your Orders ── */}
          {menuSection === "orders" && (
            <>
              <button onClick={() => setMenuSection("main")} style={{ background: "none", border: "none", cursor: "pointer", padding: "0 0 28px", textAlign: "left", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(200,144,58,0.6)", WebkitTapHighlightColor: "transparent" }}>← Back</button>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <p style={{ margin: 0, fontFamily: "var(--font-heading)", fontSize: 30, fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.04em" }}>Orders</p>
                <button onClick={() => fetchOrders(true)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(200,144,58,0.6)", WebkitTapHighlightColor: "transparent" }}>↻ Refresh</button>
              </div>
              {ordersLoading && orders.length === 0 && <p style={{ fontFamily: "var(--font-body)", fontSize: 15, color: "rgba(240,223,200,0.3)", letterSpacing: "0.1em" }}>Loading…</p>}
              {!ordersLoading && orders.length === 0 && (
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
            </>
          )}

          {/* ── Subscription ── */}
          {menuSection === "subscription" && (
            <>
              <button onClick={() => setMenuSection("main")} style={{ background: "none", border: "none", cursor: "pointer", padding: "0 0 28px", textAlign: "left", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(200,144,58,0.6)", WebkitTapHighlightColor: "transparent" }}>← Back</button>
              <p style={{ margin: "0 0 24px", fontFamily: "var(--font-heading)", fontSize: 30, fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.04em" }}>Subscription</p>
              <p style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "rgba(240,223,200,0.35)", lineHeight: 1.7 }}>Subscription plans coming soon. Use the shop to set up recurring deliveries.</p>
            </>
          )}

          {/* ── Reports ── */}
          {menuSection === "reports" && (
            <>
              <button onClick={() => setMenuSection("main")} style={{ background: "none", border: "none", cursor: "pointer", padding: "0 0 28px", textAlign: "left", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(200,144,58,0.6)", WebkitTapHighlightColor: "transparent" }}>← Back</button>
              <p style={{ margin: "0 0 10px", fontFamily: "var(--font-heading)", fontSize: 30, fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.04em" }}>Reports</p>
              <p style={{ margin: "0 0 28px", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, color: "rgba(240,223,200,0.45)", lineHeight: 1.6, letterSpacing: "0.02em" }}>Independent test reports for each loaf.</p>
              {PRODUCTS.map((p) => (
                <button
                  key={p.slug}
                  onClick={() => nav(`/shop/${p.slug}/reports`)}
                  style={{
                    background: "none", border: "none", cursor: "pointer", padding: "18px 0",
                    textAlign: "left", borderBottom: "1px solid rgba(240,223,200,0.06)",
                    display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12,
                    width: "100%",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span style={{ fontFamily: "var(--font-heading)", fontSize: 24, fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.03em" }}>{p.title}</span>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(200,144,58,0.65)" }}>View →</span>
                </button>
              ))}
            </>
          )}

          {/* ── Store Locator ── */}
          {menuSection === "locator" && (() => {
            const q = locatorSearch.trim();
            const allAreas = VIZAG_AREAS;
            const allShops: { area: string; store: { name: string; address: string } }[] =
              allAreas.flatMap(area => (STORES[area] ?? []).map(store => ({ area, store })));

            // Fuzzy-ranked area list (full list when q is empty)
            const matchingAreas = q
              ? allAreas
                  .map(area => ({ area, score: fuzzyScore(q, area) }))
                  .filter(x => x.score > 0)
                  .sort((a, b) => b.score - a.score)
                  .map(x => x.area)
              : allAreas;

            // Fuzzy-ranked shop list when searching: best of (shop name, address, area)
            const matchingShops = q
              ? allShops
                  .map(({ area, store }) => ({
                    area, store,
                    score: Math.max(
                      fuzzyScore(q, store.name),
                      fuzzyScore(q, store.address),
                      Math.max(0, fuzzyScore(q, area) - 50),
                    ),
                  }))
                  .filter(x => x.score > 0)
                  .sort((a, b) => b.score - a.score)
                  .map(({ area, store }) => ({ area, store }))
              : [];

            // Resolve currently displayed shop list (only after a selection):
            const selectedShopHit = locatorStore
              ? allShops.find(s => s.store.name === locatorStore) ?? null
              : null;
            const visibleShops = selectedShopHit
              ? [selectedShopHit]
              : (locatorArea ? (STORES[locatorArea] ?? []).map(store => ({ area: locatorArea, store })) : []);

            const triggerLabel = locatorStore
              ? locatorStore
              : locatorArea
                ? locatorArea
                : "Select location";

            return (
              <>
                <button onClick={() => setMenuSection("main")} style={{ background: "none", border: "none", cursor: "pointer", padding: "0 0 28px", textAlign: "left", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(200,144,58,0.6)", WebkitTapHighlightColor: "transparent" }}>← Back</button>
                <p style={{ margin: "0 0 10px", fontFamily: "var(--font-heading)", fontSize: 30, fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.04em" }}>Store Locator</p>
                <p style={{ margin: "0 0 22px", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, color: "rgba(240,223,200,0.45)", lineHeight: 1.6, letterSpacing: "0.02em" }}>Find a store near you that stocks Cadieux.</p>

                {/* Dropdown trigger */}
                <button
                  onClick={() => setLocatorDropdownOpen(o => !o)}
                  aria-expanded={locatorDropdownOpen}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    background: "rgba(240,223,200,0.04)",
                    border: "1px solid rgba(240,223,200,0.12)",
                    borderRadius: locatorDropdownOpen ? "4px 4px 0 0" : 4,
                    padding: "12px 14px",
                    cursor: "pointer", textAlign: "left",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200,
                    color: (locatorArea || locatorStore) ? "#FBF3D4" : "rgba(240,223,200,0.5)",
                    letterSpacing: "0.02em",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{triggerLabel}</span>
                  <span style={{ color: "rgba(200,144,58,0.7)", fontSize: 12, transform: locatorDropdownOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", flexShrink: 0, marginLeft: 8 }}>▾</span>
                </button>

                {/* Dropdown panel — contains the search column + the list */}
                {locatorDropdownOpen && (
                  <div style={{
                    border: "1px solid rgba(240,223,200,0.12)",
                    borderTop: "none",
                    borderRadius: "0 0 4px 4px",
                    overflow: "hidden",
                  }}>
                    {/* Search column inside dropdown */}
                    <input
                      type="text"
                      autoFocus
                      value={locatorSearch}
                      onChange={e => setLocatorSearch(e.target.value)}
                      placeholder="Search area or shop…"
                      aria-label="Search store locator"
                      style={{
                        width: "100%", boxSizing: "border-box",
                        background: "rgba(0,0,0,0.25)",
                        border: "none",
                        borderBottom: "1px solid rgba(240,223,200,0.10)",
                        padding: "12px 14px",
                        fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200,
                        color: "#FBF3D4", letterSpacing: "0.02em",
                        outline: "none",
                      }}
                    />

                    {/* Scrollable list — swipe-friendly on touch */}
                    <div style={{
                      maxHeight: 280,
                      overflowY: "auto",
                      WebkitOverflowScrolling: "touch",
                      touchAction: "pan-y",
                      overscrollBehavior: "contain",
                    }}>
                    {/* When searching: shop hits then any extra matching areas. Else: full area list */}
                    {q ? (() => {
                      const coveredAreas = new Set(matchingShops.map(h => h.area));
                      const extraAreas = matchingAreas.filter(a => !coveredAreas.has(a));
                      if (matchingShops.length === 0 && extraAreas.length === 0) {
                        return <p style={{ margin: 0, padding: "14px", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, color: "rgba(240,223,200,0.4)" }}>No matches for “{locatorSearch}”.</p>;
                      }
                      return (
                        <>
                          {matchingShops.map(({ area, store }) => (
                            <button
                              key={`shop-${area}-${store.name}`}
                              onClick={() => {
                                setLocatorArea(area);
                                setLocatorStore(store.name);
                                setLocatorDropdownOpen(false);
                                setLocatorSearch("");
                              }}
                              style={{
                                width: "100%", display: "block", textAlign: "left",
                                background: "transparent",
                                border: "none", cursor: "pointer",
                                padding: "12px 14px",
                                borderBottom: "1px solid rgba(240,223,200,0.06)",
                                WebkitTapHighlightColor: "transparent",
                              }}
                            >
                              <span style={{ display: "block", fontFamily: "var(--font-heading)", fontSize: 16, fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em" }}>{store.name}</span>
                              <span style={{ display: "block", marginTop: 4, fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(200,144,58,0.65)" }}>{area}</span>
                            </button>
                          ))}
                          {extraAreas.length > 0 && matchingShops.length > 0 && (
                            <p style={{ margin: 0, padding: "10px 14px 6px", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(200,144,58,0.45)", background: "rgba(0,0,0,0.15)" }}>Areas</p>
                          )}
                          {extraAreas.map(area => (
                            <button
                              key={`area-${area}`}
                              onClick={() => {
                                setLocatorArea(area);
                                setLocatorStore(null);
                                setLocatorDropdownOpen(false);
                                setLocatorSearch("");
                              }}
                              style={{
                                width: "100%", display: "flex", justifyContent: "space-between", alignItems: "baseline",
                                background: "transparent",
                                border: "none", cursor: "pointer",
                                padding: "12px 14px",
                                borderBottom: "1px solid rgba(240,223,200,0.06)",
                                fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200,
                                color: "#FBF3D4", letterSpacing: "0.02em",
                                WebkitTapHighlightColor: "transparent",
                              }}
                            >
                              <span>{area}</span>
                              <span style={{ fontSize: 11, color: "rgba(200,144,58,0.55)", letterSpacing: "0.2em" }}>
                                {(STORES[area] ?? []).length}
                              </span>
                            </button>
                          ))}
                        </>
                      );
                    })() : (
                      <>
                        {matchingAreas.map(area => (
                          <button
                            key={area}
                            onClick={() => {
                              setLocatorArea(area);
                              setLocatorStore(null);
                              setLocatorDropdownOpen(false);
                              setLocatorSearch("");
                            }}
                            style={{
                              width: "100%", display: "flex", justifyContent: "space-between", alignItems: "baseline",
                              background: locatorArea === area && !locatorStore ? "rgba(200,144,58,0.08)" : "transparent",
                              border: "none", cursor: "pointer",
                              padding: "12px 14px",
                              borderBottom: "1px solid rgba(240,223,200,0.06)",
                              fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200,
                              color: "#FBF3D4", letterSpacing: "0.02em",
                              WebkitTapHighlightColor: "transparent",
                            }}
                          >
                            <span>{area}</span>
                            <span style={{ fontSize: 11, color: "rgba(200,144,58,0.55)", letterSpacing: "0.2em" }}>
                              {(STORES[area] ?? []).length}
                            </span>
                          </button>
                        ))}
                      </>
                    )}
                    </div>
                  </div>
                )}

                <div style={{ marginBottom: 18 }} />

                {/* Shops shown ONLY after the user picks an area or shop */}
                {visibleShops.length === 0 ? (
                  locatorArea ? (
                    <p style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200, color: "rgba(240,223,200,0.35)", lineHeight: 1.7 }}>No stores we supply in {locatorArea} yet — we&apos;re expanding fast.</p>
                  ) : (
                    <p style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200, color: "rgba(240,223,200,0.35)", lineHeight: 1.7 }}>Pick a location to see the stores we supply in that area.</p>
                  )
                ) : (
                  <>
                    <p style={{ margin: "0 0 12px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(200,144,58,0.6)" }}>
                      {locatorStore ? "Store we supply" : locatorArea}
                    </p>
                    {visibleShops.map(({ area, store }) => (
                      <div key={`${area}-${store.name}`} style={{ borderBottom: "1px solid rgba(240,223,200,0.07)", padding: "14px 0" }}>
                        <p style={{ margin: "0 0 4px", fontFamily: "var(--font-heading)", fontSize: 20, fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.03em" }}>{store.name}</p>
                        {locatorStore && (
                          <p style={{ margin: "0 0 6px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(200,144,58,0.65)" }}>{area}</p>
                        )}
                        <p style={{ margin: "0 0 12px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200, color: "rgba(240,223,200,0.55)", lineHeight: 1.6 }}>{store.address}</p>
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${store.name}, ${store.address}`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: "inline-block", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(200,144,58,0.75)", textDecoration: "none", borderBottom: "1px solid rgba(200,144,58,0.4)", paddingBottom: 2 }}
                        >
                          Get Directions →
                        </a>
                      </div>
                    ))}
                  </>
                )}
              </>
            );
          })()}

          {/* ── Connect With Us ── */}
          {menuSection === "connect" && (
            <>
              <button onClick={() => setMenuSection("main")} style={{ background: "none", border: "none", cursor: "pointer", padding: "0 0 28px", textAlign: "left", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(200,144,58,0.6)", WebkitTapHighlightColor: "transparent" }}>← Back</button>
              <p style={{ margin: "0 0 32px", fontFamily: "var(--font-heading)", fontSize: 30, fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.04em" }}>Connect</p>
              {[
                { label: "Instagram", value: "@cadieux.in",     href: "https://instagram.com/cadieux.in" },
                { label: "WhatsApp",  value: "+91 98765 43210", href: "https://wa.me/919876543210" },
                { label: "Email",     value: "hello@cadieux.in", href: "mailto:hello@cadieux.in" },
                { label: "Phone",     value: "+91 98765 43210", href: "tel:+919876543210" },
              ].map(({ label, value, href }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 0", borderBottom: "1px solid rgba(240,223,200,0.06)", textDecoration: "none" }}>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(200,144,58,0.65)" }}>{label}</span>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200, color: "rgba(240,223,200,0.7)", letterSpacing: "0.04em" }}>{value}</span>
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
