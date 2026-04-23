"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/context/CartContext";
import { PRODUCTS, DAYS, TIMES, SUB_WEEKS, type CartItem } from "@/lib/data";

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

function chip(selected: boolean) {
  return {
    fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
    letterSpacing: "0.25em", textTransform: "uppercase" as const,
    padding: "8px 18px", cursor: "pointer", border: "none",
    background: selected ? "#024628" : "rgba(251,243,212,0.07)",
    color: selected ? "#FBF3D4" : "rgba(251,243,212,0.5)",
    WebkitTapHighlightColor: "transparent",
    transition: "background 0.2s, color 0.2s",
  };
}

export default function ShopPage() {
  const router = useRouter();
  const { addToCart, cartCount } = useCart();

  const [qty, setQty] = useState([1, 1]);
  const [orderType, setOrderType] = useState<("once" | "sub")[]>(["once", "once"]);
  const [weeks, setWeeks] = useState<(number | null)[]>([null, null]);
  const [day, setDay] = useState(["", ""]);
  const [time, setTime] = useState(["", ""]);

  function canAdd(i: number) {
    if (qty[i] < 1) return false;
    if (orderType[i] === "once") return true;
    return weeks[i] !== null && day[i] !== "" && time[i] !== "";
  }

  function update<T>(arr: T[], i: number, val: T): T[] {
    return arr.map((v, j) => (j === i ? val : v));
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#1D1D1F", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />

      {/* Back link */}
      <Link href="/" style={{
        position: "fixed", top: 24, left: 20, zIndex: 101,
        fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
        letterSpacing: "0.35em", textTransform: "uppercase",
        color: "#4369B2", textDecoration: "none",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>←</span> Cadieux
      </Link>

      <div style={{ position: "relative", zIndex: 1, padding: "100px clamp(28px,8vw,120px) 120px" }}>
        <h1 style={{ margin: "0 0 64px", fontFamily: "var(--font-heading)", fontSize: "clamp(52px,12vw,96px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1 }}>
          Our Breads
        </h1>

        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {PRODUCTS.map((p, i) => (
            <div key={i} style={{ borderTop: "1px solid rgba(240,223,200,0.1)", paddingTop: 36, paddingBottom: 56, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ width: "100%", aspectRatio: "16/9", overflow: "hidden", marginBottom: 8, background: "rgba(255,255,255,0.04)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.image} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", filter: "brightness(0.88) contrast(1.05)" }} />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <p style={{ margin: 0, fontFamily: "var(--font-heading)", fontSize: "clamp(22px,5vw,38px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.01em", lineHeight: 1.2, maxWidth: "65%" }}>{p.name}</p>
                <p style={{ margin: 0, fontFamily: "var(--font-heading)", fontSize: "clamp(28px,6vw,44px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em" }}>₹{p.price}</p>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {p.tags.map((tag, j) => (
                  <span key={j} style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(251,243,212,0.5)", border: "1px solid rgba(251,243,212,0.15)", padding: "6px 14px" }}>{tag}</span>
                ))}
              </div>

              <div style={{ display: "flex", gap: 32 }}>
                <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(251,243,212,0.45)" }}>{p.protein}</p>
                <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(251,243,212,0.45)" }}>{p.weight}</p>
              </div>

              <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, lineHeight: 1.8, color: "rgba(251,243,212,0.55)", maxWidth: 480 }}>{p.desc}</p>

              {/* Qty */}
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
                <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(251,243,212,0.4)" }}>Qty</span>
                <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid rgba(251,243,212,0.15)" }}>
                  <button onClick={() => setQty(q => update(q, i, Math.max(1, q[i] - 1)))} style={{ ...chip(false), padding: "8px 16px", fontSize: 16, lineHeight: 1 }}>−</button>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "#FBF3D4", width: 36, textAlign: "center" }}>{qty[i]}</span>
                  <button onClick={() => setQty(q => update(q, i, q[i] + 1))} style={{ ...chip(false), padding: "8px 16px", fontSize: 16, lineHeight: 1 }}>+</button>
                </div>
              </div>

              {/* Order type */}
              <div style={{ display: "flex", gap: 0, marginTop: 4 }}>
                <button onClick={() => { setOrderType(t => update(t, i, "once")); setWeeks(w => update(w, i, null)); setDay(d => update(d, i, "")); setTime(t => update(t, i, "")); }} style={{ ...chip(orderType[i] === "once"), borderRight: "1px solid rgba(251,243,212,0.08)" }}>One Time</button>
                <button onClick={() => setOrderType(t => update(t, i, "sub"))} style={chip(orderType[i] === "sub")}>Subscribe</button>
              </div>

              {orderType[i] === "sub" && (
                <div>
                  <p style={{ margin: "0 0 10px", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(251,243,212,0.4)" }}>Delivery every</p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {SUB_WEEKS.map(w => (
                      <button key={w} onClick={() => { setWeeks(wk => update(wk, i, w)); setDay(d => update(d, i, "")); setTime(t => update(t, i, "")); }} style={chip(weeks[i] === w)}>{w} Weeks</button>
                    ))}
                  </div>
                </div>
              )}

              {orderType[i] === "sub" && weeks[i] !== null && (
                <div>
                  <p style={{ margin: "0 0 10px", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(251,243,212,0.4)" }}>Delivery day</p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {DAYS.map(d => (
                      <button key={d} onClick={() => { setDay(dy => update(dy, i, d)); setTime(t => update(t, i, "")); }} style={chip(day[i] === d)}>{d}</button>
                    ))}
                  </div>
                </div>
              )}

              {orderType[i] === "sub" && weeks[i] !== null && day[i] !== "" && (
                <div>
                  <p style={{ margin: "0 0 10px", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(251,243,212,0.4)" }}>Delivery time</p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {TIMES.map(t => (
                      <button key={t} onClick={() => setTime(tm => update(tm, i, t))} style={chip(time[i] === t)}>{t}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* Add to Cart + View Cart */}
              <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
                <button
                  disabled={!canAdd(i)}
                  onClick={() => {
                    const item: CartItem = {
                      productIndex: i, name: p.name, price: p.price, qty: qty[i],
                      orderType: orderType[i],
                      weeks: orderType[i] === "sub" ? weeks[i]! : undefined,
                      day: orderType[i] === "sub" ? day[i] : undefined,
                      time: orderType[i] === "sub" ? time[i] : undefined,
                    };
                    addToCart(item);
                  }}
                  style={{ flex: 1, background: canAdd(i) ? "#024628" : "rgba(2,70,40,0.3)", border: "none", padding: "14px 0", cursor: canAdd(i) ? "pointer" : "default", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.4em", textTransform: "uppercase", color: canAdd(i) ? "#FBF3D4" : "rgba(251,243,212,0.3)", WebkitTapHighlightColor: "transparent", transition: "background 0.3s, color 0.3s" }}
                >Add to Cart</button>
                <button
                  disabled={cartCount === 0}
                  onClick={() => router.push("/cart")}
                  style={{ flex: 1, background: cartCount > 0 ? "#f0dfc8" : "transparent", border: cartCount > 0 ? "none" : "1px solid rgba(240,223,200,0.15)", padding: "14px 0", cursor: cartCount > 0 ? "pointer" : "default", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.4em", textTransform: "uppercase", color: cartCount > 0 ? "#080604" : "rgba(240,223,200,0.2)", WebkitTapHighlightColor: "transparent", transition: "background 0.3s, color 0.3s, border 0.3s" }}
                >
                  View Cart{cartCount > 0 ? ` (${cartCount})` : ""}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
