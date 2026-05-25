"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ScrollReveal from "@/components/ScrollReveal";
import { useCart } from "@/context/CartContext";

const GRAIN = "url(/grain.svg)";

const REQUEST_KEY = "cadieux_delivery_request";
const DISMISS_KEY = "cadieux_delivery_request_dismissed";

type BannerState =
  | { kind: "pending"; pincode: string }
  | { kind: "serviceable"; pincode: string; area_name: string | null }
  | null;

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

export default function CartPage() {
  const { cart, cartTotal, updateQty, removeFromCart } = useCart();
  const router = useRouter();
  const banner = useDeliveryRequestBanner();

  return (
    <div style={{ minHeight: "100dvh", background: "#1D1D1F", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />

      {/* Back link */}
      <Link href="/shop" style={{
        position: "fixed", top: "calc(24px + env(safe-area-inset-top))", left: "calc(20px + env(safe-area-inset-left))", zIndex: 101,
        fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
        letterSpacing: "0.35em", textTransform: "uppercase",
        color: "#4369B2", textDecoration: "none",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>←</span> Shop
      </Link>

      <div style={{ position: "relative", zIndex: 1, padding: "100px clamp(28px,8vw,120px) 120px" }}>
        <ScrollReveal>
          <h1 data-stagger style={{ margin: "0 0 48px", fontFamily: "var(--font-heading)", fontSize: "clamp(52px,12vw,96px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1 }}>
            Your Cart
          </h1>
        </ScrollReveal>

        {banner && <DeliveryRequestBanner banner={banner} />}

        {cart.length === 0 ? (
          <div>
            <p style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, color: "rgba(251,243,212,0.4)", letterSpacing: "0.1em", marginBottom: 32 }}>Your cart is empty.</p>
            <Link href="/shop" style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase", color: "#FBF3D4", textDecoration: "none", background: "#024628", padding: "14px 28px", display: "inline-block" }}>
              Explore Breads
            </Link>
          </div>
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
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                        <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "#4369B2", border: "1px solid rgba(67,105,178,0.3)", padding: "4px 12px" }}>Subscription</span>
                        <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(251,243,212,0.35)", padding: "4px 0" }}>
                          {item.weeks} {item.weeks === 1 ? "week" : "weeks"}
                          {item.days && item.days.length > 0 ? ` · ${item.days.length} ${item.days.length === 1 ? "day" : "days"}/wk` : ""}
                        </span>
                      </div>
                      {item.slotMode === "custom" && item.slotsByDay ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 2 }}>
                          {(item.days || []).map((label) => (
                            <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, color: "rgba(251,243,212,0.55)", letterSpacing: "0.05em" }}>
                              <span>{label}</span>
                              <span>{item.slotsByDay![label.toLowerCase().slice(0, 3)] || "—"}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, color: "rgba(251,243,212,0.55)", letterSpacing: "0.05em" }}>
                          {(item.days || (item.day ? [item.day] : [])).join(", ")}
                          {item.slot || item.time ? ` · ${item.slot || item.time}` : ""}
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    {item.orderType === "sub" ? (
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.25em", color: "rgba(251,243,212,0.35)", textTransform: "uppercase" }}>
                        Full plan
                      </span>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid rgba(251,243,212,0.15)" }}>
                        <button onClick={() => updateQty(i, Math.max(1, item.qty - 1))} style={{ ...chip(false), padding: "7px 14px", fontSize: 16, lineHeight: 1 }}>−</button>
                        <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, color: "#FBF3D4", width: 34, textAlign: "center" }}>{item.qty}</span>
                        <button onClick={() => updateQty(i, item.qty + 1)} style={{ ...chip(false), padding: "7px 14px", fontSize: 16, lineHeight: 1 }}>+</button>
                      </div>
                    )}

                    <span style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.2em", color: "rgba(251,243,212,0.35)", textTransform: "uppercase" }}>
                      {item.orderType === "sub" ? `₹${item.price} total` : `₹${item.price} each`}
                    </span>

                    <button
                      onClick={() => removeFromCart(i)}
                      style={{ background: "none", border: "1px solid rgba(251,243,212,0.1)", cursor: "pointer", padding: "7px 14px", fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(251,243,212,0.35)", WebkitTapHighlightColor: "transparent", transition: "color 0.2s, border-color 0.2s" }}
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
              <p style={{ margin: 0, fontFamily: "var(--font-heading)", fontSize: "clamp(28px,6vw,42px)", fontWeight: 300, color: "#FBF3D4" }}>₹{cartTotal}</p>
            </div>

            <button
              onClick={() => router.push("/checkout")}
              style={{ display: "block", width: "100%", marginTop: 32, background: "#024628", border: "none", padding: "18px 0", cursor: "pointer", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300, letterSpacing: "0.45em", textTransform: "uppercase", color: "#FBF3D4", WebkitTapHighlightColor: "transparent" }}
            >
              Proceed to Checkout
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Delivery request banner ─────────────────────────────────────────── */

function useDeliveryRequestBanner(): BannerState {
  const [banner, setBanner] = useState<BannerState>(null);

  useEffect(() => {
    // Always honour a fresh request submitted this session — show the
    // amber "we got your request" banner once, then suppress until next
    // session via the dismiss flag.
    if (typeof window === "undefined") return;
    const dismissed = sessionStorage.getItem(DISMISS_KEY) === "1";
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(REQUEST_KEY);
    } catch {
      raw = null;
    }
    if (raw && !dismissed) {
      try {
        const parsed = JSON.parse(raw) as { pincode?: string };
        if (parsed.pincode) {
          setBanner({ kind: "pending", pincode: parsed.pincode });
          return;
        }
      } catch {
        /* malformed — fall through */
      }
    }

    // Otherwise check by saved phone whether the customer has an
    // outstanding delivery request the admin may have already activated.
    const phone =
      (typeof localStorage !== "undefined" &&
        localStorage.getItem("cadieux_phone")) ||
      null;
    if (!phone) return;
    fetch(`/api/delivery-requests/by-phone?phone=${encodeURIComponent(phone)}`)
      .then((r) => r.json())
      .then((d: { request?: { pincode: string; status: string; area_name: string | null } | null }) => {
        if (!d?.request) return;
        if (d.request.status === "serviceable") {
          setBanner({
            kind: "serviceable",
            pincode: d.request.pincode,
            area_name: d.request.area_name ?? null,
          });
        } else if (d.request.status === "pending") {
          setBanner({ kind: "pending", pincode: d.request.pincode });
        }
      })
      .catch(() => {});
  }, []);

  return banner;
}

function DeliveryRequestBanner({ banner }: { banner: NonNullable<BannerState> }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const isPending = banner.kind === "pending";
  const accent = isPending ? "#f59e0b" : "#4ade80";
  const bg = isPending ? "rgba(245,158,11,0.08)" : "rgba(74,222,128,0.08)";
  return (
    <div
      style={{
        marginBottom: 32,
        padding: "18px 22px",
        border: `1px solid ${accent}`,
        background: bg,
        display: "flex",
        alignItems: "flex-start",
        gap: 16,
        position: "relative",
      }}
    >
      <div style={{ flex: 1 }}>
        <p
          style={{
            margin: "0 0 6px",
            fontFamily: "var(--font-body)",
            fontSize: 10,
            fontWeight: 300,
            letterSpacing: "0.35em",
            textTransform: "uppercase",
            color: accent,
          }}
        >
          {isPending ? "Request received" : "Good news"}
        </p>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-body)",
            fontSize: 13,
            fontWeight: 200,
            lineHeight: 1.6,
            color: "rgba(251,243,212,0.78)",
            letterSpacing: "0.04em",
          }}
        >
          {isPending
            ? `Thanks — we've got your request to deliver to ${banner.pincode}. The team will reach out shortly on WhatsApp. Your cart is saved.`
            : `We now deliver to ${banner.pincode}${
                banner.area_name ? ` (${banner.area_name})` : ""
              }. Tap "Proceed to Checkout" to complete your order.`}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          try {
            sessionStorage.setItem(DISMISS_KEY, "1");
            sessionStorage.removeItem(REQUEST_KEY);
          } catch {
            /* private mode */
          }
          setDismissed(true);
        }}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "rgba(251,243,212,0.4)",
          fontSize: 16,
          lineHeight: 1,
          padding: 4,
        }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
