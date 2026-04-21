"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getLenis } from "@/lib/scroll";
import CheckoutModal from "./CheckoutModal";
import { supabase } from "@/lib/supabase";
import { useCart } from "@/context/CartContext";
import {
  PRODUCTS, BLOG_POSTS, PROCESS_STEPS, VIZAG_AREAS, STORES,
  DAYS, TIMES, SUB_WEEKS,
  type CartItem,
} from "@/lib/data";

type Page = "blogs" | "making" | "store-locator" | "shop" | "cart" | null;

type Order = {
  id: string;
  total_amount: number;
  delivery_address: string;
  status: string;
  created_at: string;
};

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/* ── Sub-page content (used for home-page overlays) ── */
function BlogsContent() {
  const [open, setOpen] = useState<number | null>(null);

  if (open !== null) {
    const post = BLOG_POSTS[open];
    return (
      <>
        <button
          onClick={() => setOpen(null)}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            display: "flex", alignItems: "center", gap: 8, marginBottom: 48,
            fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
            letterSpacing: "0.35em", textTransform: "uppercase",
            color: "#4369B2", WebkitTapHighlightColor: "transparent",
          }}
        >
          <span style={{ fontSize: 14 }}>←</span> All Stories
        </button>
        <h1 style={{
          margin: "0 0 40px", fontFamily: "var(--font-heading)",
          fontSize: "clamp(28px,7vw,56px)", fontWeight: 300,
          color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1.15,
        }}>{post.title}</h1>
        <div style={{ maxWidth: 600 }}>
          {post.body.split("\n\n").map((para, i) => (
            <p key={i} style={{
              margin: "0 0 28px", fontFamily: "var(--font-body)",
              fontSize: 13, fontWeight: 200, lineHeight: 1.9,
              color: "rgba(251,243,212,0.7)",
            }}>{para}</p>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <h1 style={{
        margin: "0 0 64px", fontFamily: "var(--font-heading)",
        fontSize: "clamp(52px,12vw,96px)", fontWeight: 300,
        color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1,
      }}>Stories &amp; Bakes</h1>
      {BLOG_POSTS.map((post, i) => (
        <div key={i} onClick={() => setOpen(i)} style={{
          borderTop: "1px solid rgba(240,223,200,0.08)", paddingTop: 28, marginBottom: 36,
          cursor: "pointer",
        }}>
          <p style={{
            margin: "0 0 12px", fontFamily: "var(--font-heading)",
            fontSize: "clamp(20px,4vw,32px)", fontWeight: 300,
            color: "rgba(251,243,212,0.85)", letterSpacing: "0.01em", lineHeight: 1.2,
          }}>{post.title}</p>
          <p style={{
            margin: "0 0 14px", fontFamily: "var(--font-body)",
            fontSize: 12, fontWeight: 200, lineHeight: 1.8,
            color: "rgba(251,243,212,0.45)",
            display: "-webkit-box", WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical" as never, overflow: "hidden",
          }}>{post.brief}</p>
          <span style={{
            fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200,
            letterSpacing: "0.4em", textTransform: "uppercase", color: "#4369B2",
          }}>Read more →</span>
        </div>
      ))}
    </>
  );
}

function MakingContent() {
  return (
    <>
      <h1 style={{
        margin: "0 0 16px", fontFamily: "var(--font-heading)",
        fontSize: "clamp(52px,12vw,96px)", fontWeight: 300,
        color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1,
      }}>How It&apos;s Made</h1>
      <p style={{
        margin: "0 0 56px", fontFamily: "var(--font-body)", fontSize: 11,
        fontWeight: 200, letterSpacing: "0.25em", textTransform: "uppercase",
        color: "#4369B2", lineHeight: 2.2,
      }}>Six steps. No shortcuts.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {PROCESS_STEPS.map((step, i) => (
          <div key={i} style={{ borderTop: "1px solid rgba(240,223,200,0.08)", paddingTop: 32, paddingBottom: 40 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.3em", color: "rgba(251,243,212,0.3)" }}>{step.num}</span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 400, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(30,30,30,0.85)", background: step.tagColor, padding: "3px 10px", borderRadius: 20 }}>{step.tag}</span>
            </div>
            <p style={{ margin: "0 0 8px", fontFamily: "var(--font-heading)", fontSize: "clamp(22px,5vw,38px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.01em", lineHeight: 1.1 }}>{step.title}</p>
            <p style={{ margin: "0 0 16px", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, letterSpacing: "0.05em", color: "#4369B2" }}>{step.highlight}</p>
            <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, lineHeight: 1.85, color: "rgba(251,243,212,0.45)", maxWidth: 520 }}>{step.desc}</p>
          </div>
        ))}
      </div>
    </>
  );
}

function StoreContent() {
  const [selected, setSelected] = useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = VIZAG_AREAS.filter(a => a.toLowerCase().includes(query.toLowerCase()));
  const results = selected ? (STORES[selected] ?? []) : null;

  function pick(area: string) { setSelected(area); setQuery(area); setOpen(false); }

  return (
    <>
      <h1 style={{ margin: "0 0 48px", fontFamily: "var(--font-heading)", fontSize: "clamp(52px,12vw,96px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1 }}>Find Cadieux</h1>
      <div style={{ maxWidth: 440 }}>
        <p style={{ margin: "0 0 16px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(251,243,212,0.5)" }}>Select your area in Vizag</p>
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", border: "1px solid rgba(251,243,212,0.2)", background: "rgba(251,243,212,0.04)", padding: "14px 16px", cursor: "text" }} onClick={() => setOpen(true)}>
            <input value={query} onChange={e => { setQuery(e.target.value); setSelected(""); setOpen(true); }} onFocus={() => { setQuery(""); setOpen(true); }} onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder="Type or select an area…" style={{ flex: 1, background: "none", border: "none", outline: "none", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "#FBF3D4" }} />
            <span onClick={e => { e.stopPropagation(); if (open) setOpen(false); else { setQuery(""); setOpen(true); } }} style={{ cursor: "pointer", userSelect: "none", color: "rgba(251,243,212,0.4)", fontSize: 14, transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", display: "inline-block", lineHeight: 1 }}>▾</span>
          </div>
          {open && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#1a1a1c", border: "1px solid rgba(251,243,212,0.12)", borderTop: "none", maxHeight: "calc(7 * 48px)", overflowY: "auto", overscrollBehavior: "contain" }}>
              {filtered.length === 0 ? (
                <div style={{ padding: "14px 16px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(251,243,212,0.3)" }}>No areas found</div>
              ) : filtered.map(area => (
                <button key={area} onMouseDown={e => { e.preventDefault(); pick(area); }} style={{ display: "block", width: "100%", background: "none", border: "none", borderBottom: "1px solid rgba(251,243,212,0.06)", padding: "14px 16px", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: selected === area ? "#FBF3D4" : "rgba(251,243,212,0.55)", WebkitTapHighlightColor: "transparent" }}>{area}</button>
              ))}
            </div>
          )}
        </div>
        {selected && results !== null && (
          <div style={{ marginTop: 40 }}>
            {results.length === 0 ? (
              <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(251,243,212,0.35)" }}>No stores found in {selected} yet.</p>
            ) : results.map((s, i) => (
              <div key={i} style={{ borderTop: "1px solid rgba(251,243,212,0.1)", paddingTop: 20 }}>
                <p style={{ margin: "0 0 8px", fontFamily: "var(--font-heading)", fontSize: "clamp(22px,5vw,32px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.01em" }}>{s.name}</p>
                <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(251,243,212,0.4)" }}>{s.address}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

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

function ShopContent({ cartCount, onAddToCart, onViewCart }: {
  cartCount: number;
  onAddToCart: (item: CartItem) => void;
  onViewCart: () => void;
}) {
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
    <>
      <h1 style={{ margin: "0 0 64px", fontFamily: "var(--font-heading)", fontSize: "clamp(52px,12vw,96px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1 }}>Our Breads</h1>
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
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(251,243,212,0.4)" }}>Qty</span>
              <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid rgba(251,243,212,0.15)" }}>
                <button onClick={() => setQty(q => update(q, i, Math.max(1, q[i] - 1)))} style={{ ...chip(false), padding: "8px 16px", fontSize: 16, lineHeight: 1 }}>−</button>
                <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "#FBF3D4", width: 36, textAlign: "center" }}>{qty[i]}</span>
                <button onClick={() => setQty(q => update(q, i, q[i] + 1))} style={{ ...chip(false), padding: "8px 16px", fontSize: 16, lineHeight: 1 }}>+</button>
              </div>
            </div>
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
                  onAddToCart(item);
                }}
                style={{ flex: 1, background: canAdd(i) ? "#024628" : "rgba(2,70,40,0.3)", border: "none", padding: "14px 0", cursor: canAdd(i) ? "pointer" : "default", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.4em", textTransform: "uppercase", color: canAdd(i) ? "#FBF3D4" : "rgba(251,243,212,0.3)", WebkitTapHighlightColor: "transparent", transition: "background 0.3s, color 0.3s" }}
              >Add to Cart</button>
              <button
                disabled={cartCount === 0}
                onClick={onViewCart}
                style={{ flex: 1, background: cartCount > 0 ? "#f0dfc8" : "transparent", border: cartCount > 0 ? "none" : "1px solid rgba(240,223,200,0.15)", padding: "14px 0", cursor: cartCount > 0 ? "pointer" : "default", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.4em", textTransform: "uppercase", color: cartCount > 0 ? "#080604" : "rgba(240,223,200,0.2)", WebkitTapHighlightColor: "transparent", transition: "background 0.3s, color 0.3s, border 0.3s" }}
              >
                View Cart{cartCount > 0 ? ` (${cartCount})` : ""}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function CartContent({
  cart,
  onCheckout,
  onUpdateQty,
  onRemove,
}: {
  cart: CartItem[];
  onCheckout: () => void;
  onUpdateQty: (index: number, qty: number) => void;
  onRemove: (index: number) => void;
}) {
  const total = cart.reduce((s, item) => s + item.price * item.qty, 0);
  return (
    <>
      <h1 style={{ margin: "0 0 48px", fontFamily: "var(--font-heading)", fontSize: "clamp(52px,12vw,96px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1 }}>Your Cart</h1>
      {cart.length === 0 ? (
        <p style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "rgba(251,243,212,0.4)", letterSpacing: "0.1em" }}>Your cart is empty.</p>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {cart.map((item, i) => (
              <div key={i} style={{ borderTop: "1px solid rgba(240,223,200,0.08)", padding: "28px 0", display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <p style={{ margin: 0, fontFamily: "var(--font-heading)", fontSize: "clamp(18px,4vw,28px)", fontWeight: 300, color: "#FBF3D4", lineHeight: 1.2, maxWidth: "70%" }}>{item.name}</p>
                  <p style={{ margin: 0, fontFamily: "var(--font-heading)", fontSize: "clamp(18px,4vw,28px)", fontWeight: 300, color: "#FBF3D4" }}>₹{item.price * item.qty}</p>
                </div>
                {item.orderType === "sub" && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "#4369B2", border: "1px solid rgba(67,105,178,0.3)", padding: "4px 12px" }}>Subscription</span>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(251,243,212,0.35)", padding: "4px 0" }}>Every {item.weeks}w · {item.day} · {item.time}</span>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid rgba(251,243,212,0.15)" }}>
                    <button onClick={() => onUpdateQty(i, Math.max(1, item.qty - 1))} style={{ ...chip(false), padding: "7px 14px", fontSize: 16, lineHeight: 1 }}>−</button>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "#FBF3D4", width: 34, textAlign: "center" }}>{item.qty}</span>
                    <button onClick={() => onUpdateQty(i, item.qty + 1)} style={{ ...chip(false), padding: "7px 14px", fontSize: 16, lineHeight: 1 }}>+</button>
                  </div>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.2em", color: "rgba(251,243,212,0.35)", textTransform: "uppercase" }}>₹{item.price} each</span>
                  <button onClick={() => onRemove(i)} style={{ background: "none", border: "1px solid rgba(251,243,212,0.1)", cursor: "pointer", padding: "7px 14px", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(251,243,212,0.35)", WebkitTapHighlightColor: "transparent", transition: "color 0.2s, border-color 0.2s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#e05a5a"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(224,90,90,0.4)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(251,243,212,0.35)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(251,243,212,0.1)"; }}
                  >Remove</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ borderTop: "1px solid rgba(240,223,200,0.15)", paddingTop: 28, marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ margin: "0 0 4px", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "rgba(251,243,212,0.5)" }}>Total</p>
              <p style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(251,243,212,0.3)" }}>Incl. GST</p>
            </div>
            <p style={{ margin: 0, fontFamily: "var(--font-heading)", fontSize: "clamp(28px,6vw,42px)", fontWeight: 300, color: "#FBF3D4" }}>₹{total}</p>
          </div>
          <button onClick={onCheckout} style={{ display: "block", width: "100%", marginTop: 32, background: "#024628", border: "none", padding: "18px 0", cursor: "pointer", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300, letterSpacing: "0.45em", textTransform: "uppercase", color: "#FBF3D4", WebkitTapHighlightColor: "transparent" }}>Proceed to Checkout</button>
        </>
      )}
    </>
  );
}

/* ── OTP Login Modal ── */
function LoginModal({ onSuccess, onClose }: { onSuccess: (name: string, phone: string) => void; onClose: () => void; }) {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resent, setResent] = useState(false);

  async function sendOtp() {
    if (!name.trim()) { setError("Please enter your name."); return; }
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10) { setError("Enter a valid 10-digit mobile number."); return; }
    setError(""); setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: "+91" + digits });
    setLoading(false);
    if (error) { setError("Supabase error: " + error.message); return; }
    setStep("otp"); setResent(false);
  }

  async function resendOtp() {
    setOtp(""); setError(""); setResent(false);
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: "+91" + phone.replace(/\D/g, "") });
    setLoading(false);
    if (error) { setError("Supabase error: " + error.message); return; }
    setResent(true);
  }

  async function verifyOtp() {
    const code = otp.replace(/\D/g, "");
    if (code.length !== 6) { setError("Enter the 6-digit code."); return; }
    setError(""); setLoading(true);
    const { error } = await supabase.auth.verifyOtp({ phone: "+91" + phone.replace(/\D/g, ""), token: code, type: "sms" });
    setLoading(false);
    if (error) { setError("Supabase error: " + error.message); setOtp(""); return; }
    onSuccess(name.trim(), phone.replace(/\D/g, ""));
  }

  const masked = `+91 ••••• ${phone.replace(/\D/g, "").slice(-5)}`;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(6,4,2,0.82)", display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: "100%", maxWidth: 520, background: "#1D1D1F", padding: "40px 32px 48px", position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none" }} />
        <button onClick={onClose} style={{ position: "absolute", top: 20, right: 20, background: "none", border: "none", cursor: "pointer", color: "rgba(251,243,212,0.35)", fontSize: 20, lineHeight: 1, WebkitTapHighlightColor: "transparent" }}>✕</button>
        <div style={{ position: "relative", zIndex: 1 }}>
          {step === "phone" ? (
            <>
              <p style={{ margin: "0 0 6px", fontFamily: "var(--font-heading)", fontSize: "clamp(28px,7vw,40px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1.1 }}>Sign in</p>
              <p style={{ margin: "0 0 36px", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(251,243,212,0.4)" }}>We&apos;ll send a one-time code to your number</p>
              <label style={{ display: "block", marginBottom: 20 }}>
                <span style={{ display: "block", marginBottom: 8, fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(251,243,212,0.45)" }}>Your Name</span>
                <input type="text" value={name} onChange={e => { setName(e.target.value); setError(""); }} placeholder="e.g. Arjun Sharma" autoComplete="name" style={{ display: "block", width: "100%", boxSizing: "border-box", background: "rgba(251,243,212,0.05)", border: "1px solid rgba(251,243,212,0.15)", padding: "14px 16px", outline: "none", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, color: "#FBF3D4", letterSpacing: "0.05em" }} />
              </label>
              <label style={{ display: "block", marginBottom: 28 }}>
                <span style={{ display: "block", marginBottom: 8, fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(251,243,212,0.45)" }}>Mobile Number</span>
                <input type="tel" inputMode="numeric" autoComplete="tel-national" value={"+91" + phone} onChange={e => { setPhone(e.target.value.replace(/^\+91/, "").replace(/[^\d]/g, "").slice(0, 10)); setError(""); }} style={{ display: "block", width: "100%", boxSizing: "border-box", background: "rgba(251,243,212,0.05)", border: "1px solid rgba(251,243,212,0.15)", padding: "14px 16px", outline: "none", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, color: "#FBF3D4", letterSpacing: "0.08em" }} />
              </label>
              {error && <p style={{ margin: "0 0 16px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, color: "#e05a5a", letterSpacing: "0.05em" }}>{error}</p>}
              <button onClick={sendOtp} disabled={loading} style={{ display: "block", width: "100%", background: loading ? "rgba(2,70,40,0.4)" : "#024628", border: "none", padding: "16px 0", cursor: loading ? "default" : "pointer", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.45em", textTransform: "uppercase", color: loading ? "rgba(251,243,212,0.4)" : "#FBF3D4", WebkitTapHighlightColor: "transparent" }}>{loading ? "Sending…" : "Generate OTP"}</button>
            </>
          ) : (
            <>
              <p style={{ margin: "0 0 6px", fontFamily: "var(--font-heading)", fontSize: "clamp(28px,7vw,40px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1.1 }}>Verify</p>
              <p style={{ margin: "0 0 36px", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.25em", color: "rgba(251,243,212,0.4)" }}>6-digit code sent to {masked}</p>
              {resent && <p style={{ margin: "0 0 16px", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.2em", color: "#4369B2" }}>Code resent.</p>}
              <label style={{ display: "block", marginBottom: 28 }}>
                <span style={{ display: "block", marginBottom: 8, fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(251,243,212,0.45)" }}>Verification Code</span>
                <input type="text" value={otp} onChange={e => { setOtp(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }} placeholder="• • • • • •" autoComplete="one-time-code" inputMode="numeric" style={{ display: "block", width: "100%", boxSizing: "border-box", background: "rgba(251,243,212,0.05)", border: "1px solid rgba(251,243,212,0.15)", padding: "16px 20px", outline: "none", fontFamily: "monospace", fontSize: 24, fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.5em", textAlign: "center" }} />
              </label>
              {error && <p style={{ margin: "0 0 16px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, color: "#e05a5a", letterSpacing: "0.05em" }}>{error}</p>}
              <button onClick={verifyOtp} disabled={loading || otp.length < 6} style={{ display: "block", width: "100%", background: (loading || otp.length < 6) ? "rgba(2,70,40,0.35)" : "#024628", border: "none", padding: "16px 0", cursor: (loading || otp.length < 6) ? "default" : "pointer", fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 300, letterSpacing: "0.45em", textTransform: "uppercase", color: (loading || otp.length < 6) ? "rgba(251,243,212,0.35)" : "#FBF3D4", WebkitTapHighlightColor: "transparent" }}>{loading ? "Verifying…" : "Confirm & Continue"}</button>
              <div style={{ marginTop: 20, display: "flex", justifyContent: "space-between" }}>
                <button onClick={() => { setStep("phone"); setOtp(""); setError(""); }} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(251,243,212,0.35)", WebkitTapHighlightColor: "transparent" }}>← Change number</button>
                <button onClick={resendOtp} disabled={loading} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "#4369B2", WebkitTapHighlightColor: "transparent" }}>Resend code</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Nav ── */
export default function Nav() {
  const router = useRouter();
  const {
    cart, cartTotal, cartCount,
    addToCart, updateQty, removeFromCart, clearCart,
    checkoutOpen, openCheckout, closeCheckout,
  } = useCart();

  const [active, setActive] = useState<Page>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuSection, setMenuSection] = useState<"main" | "orders" | "subscription" | "connect">("main");
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  // Fade home page when overlay is open
  useEffect(() => {
    const el = document.getElementById("main-page");
    if (!el) return;
    el.style.transition = "opacity 0.4s ease";
    el.style.opacity = active ? "0" : "1";
    el.style.pointerEvents = active ? "none" : "auto";
    if (active) getLenis()?.stop(); else getLenis()?.start();
  }, [active]);

  // Listen for openShop event from home page sections
  useEffect(() => {
    const handler = () => setActive("shop");
    window.addEventListener("openShop", handler);
    return () => window.removeEventListener("openShop", handler);
  }, []);

  // Intercept scroll on overlays
  useEffect(() => {
    if (!active) return;

    function findScrollable(start: HTMLElement | null, boundary: HTMLElement): HTMLElement | null {
      let el = start;
      while (el && el !== boundary) {
        if (el.scrollHeight > el.clientHeight + 2 && getComputedStyle(el).overflowY !== "visible") return el;
        el = el.parentElement;
      }
      return null;
    }

    const wheelHandler = (e: WheelEvent) => {
      const overlay = document.querySelector<HTMLElement>(`[data-overlay="${active}"]`);
      if (!overlay) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const scrollable = findScrollable(e.target as HTMLElement, overlay) ?? overlay;
      scrollable.scrollTop += e.deltaY;
    };

    let touchStartY = 0;
    const touchStart = (e: TouchEvent) => { touchStartY = e.touches[0].clientY; };
    const touchMove = (e: TouchEvent) => {
      const overlay = document.querySelector<HTMLElement>(`[data-overlay="${active}"]`);
      if (!overlay) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const deltaY = touchStartY - e.touches[0].clientY;
      touchStartY = e.touches[0].clientY;
      const scrollable = findScrollable(e.target as HTMLElement, overlay) ?? overlay;
      scrollable.scrollTop += deltaY;
    };

    window.addEventListener("wheel", wheelHandler, { passive: false, capture: true });
    window.addEventListener("touchstart", touchStart, { passive: true, capture: true });
    window.addEventListener("touchmove", touchMove, { passive: false, capture: true });
    return () => {
      window.removeEventListener("wheel", wheelHandler, { capture: true });
      window.removeEventListener("touchstart", touchStart, { capture: true });
      window.removeEventListener("touchmove", touchMove, { capture: true });
    };
  }, [active]);

  const close = () => setActive(null);

  function openMenu() {
    setMenuSection("main");
    setMenuOpen(true);
    const phone = typeof window !== "undefined" ? localStorage.getItem("cadieux_phone") : null;
    if (!phone) return;
    setOrdersLoading(true);
    fetch(`/api/checkout?phone=${encodeURIComponent(phone)}`)
      .then(r => r.json())
      .then(d => { setOrders(d.orders ?? []); })
      .catch(() => {})
      .finally(() => setOrdersLoading(false));
  }

  function nav(path: string) {
    setMenuOpen(false);
    setActive(null);
    router.push(path);
  }

  return (
    <>
      <style>{`
        input::placeholder { color: rgba(67,105,178,0.5); }
      `}</style>

      {/* ── Hamburger button ── */}
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
                { label: "Your Orders",     action: () => setMenuSection("orders") },
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
              <p style={{ margin: "0 0 24px", fontFamily: "var(--font-heading)", fontSize: 26, fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.04em" }}>Your Orders</p>
              {ordersLoading && <p style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "rgba(240,223,200,0.3)", letterSpacing: "0.1em" }}>Loading…</p>}
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

      {/* Back button when overlay open */}
      {active && (
        <button
          onClick={close}
          style={{
            position: "fixed", top: 24, left: 28, zIndex: 101,
            background: "none", border: "none", cursor: "pointer", padding: 0,
            display: "flex", alignItems: "center", gap: 8,
            fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
            letterSpacing: "0.35em", textTransform: "uppercase", color: "#4369B2",
            pointerEvents: "auto",
          }}
        >
          <span style={{ fontSize: 14, lineHeight: 1 }}>←</span>
          <span>Cadieux</span>
        </button>
      )}

      {/* Cart FAB */}
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

      {/* Sub-page overlays (triggered from home page sections) */}
      {(["blogs", "making", "store-locator", "shop", "cart"] as Page[]).map((id) => (
        <div
          key={id}
          data-overlay={id}
          style={{
            position: "fixed", inset: 0, zIndex: 99,
            background: "#1D1D1F",
            transform: active === id ? "translateY(0)" : "translateY(100vh)",
            transition: "transform 0.6s cubic-bezier(0.22,1,0.36,1)",
            pointerEvents: active === id ? "auto" : "none",
            overflowY: "auto",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch" as never,
          }}
        >
          <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />
          <div style={{ position: "relative", zIndex: 1, padding: "120px clamp(28px,8vw,120px) 80px" }}>
            {id === "blogs"         && <BlogsContent />}
            {id === "making"        && <MakingContent />}
            {id === "store-locator" && <StoreContent />}
            {id === "shop"          && <ShopContent cartCount={cartCount} onAddToCart={addToCart} onViewCart={() => setActive("cart")} />}
            {id === "cart"          && <CartContent cart={cart} onCheckout={openCheckout} onUpdateQty={updateQty} onRemove={removeFromCart} />}
          </div>
        </div>
      ))}

      {/* Checkout modal */}
      {checkoutOpen && (
        <CheckoutModal
          cart={cart}
          total={cartTotal}
          onClose={closeCheckout}
          onOrderPlaced={() => {
            clearCart();
            closeCheckout();
            setActive(null);
          }}
        />
      )}
    </>
  );
}
