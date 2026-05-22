"use client";

// Success landing after place_order completes. The /checkout route pushes
// to here with `?order=<shortId>` after clearing the cart. We render the
// check animation, the order id, and a link into /orders.

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

const GRAIN = "url(/grain.svg)";

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={null}>
      <SuccessInner />
    </Suspense>
  );
}

function SuccessInner() {
  const router = useRouter();
  const params = useSearchParams();
  const orderShort = (params.get("order") || "").toUpperCase();
  const orderId = params.get("id") || "";
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setAnimated(true), 50);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    // If somebody deep-links here without an order id, bounce to /shop
    // rather than show a blank "Order Placed" page.
    if (!params.get("order")) {
      router.replace("/shop");
    }
  }, [params, router]);

  return (
    <div style={{ minHeight: "100dvh", background: "#0e0e0e", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.05, pointerEvents: "none", zIndex: 0 }} />

      <main
        style={{
          position: "relative", zIndex: 1,
          maxWidth: 640, margin: "0 auto",
          minHeight: "100dvh",
          padding: "60px 24px 140px",
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", textAlign: "center",
        }}
      >
        <svg width="84" height="84" viewBox="0 0 72 72" style={{ marginBottom: 30 }}>
          <circle
            cx="36" cy="36" r="34"
            fill="none" stroke="#024628" strokeWidth="2"
            strokeDasharray="220"
            strokeDashoffset={animated ? 0 : 220}
            style={{ transition: "stroke-dashoffset 0.5s ease" }}
          />
          <polyline
            points="22,37 32,47 52,26"
            fill="none" stroke="#FBF3D4" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray="80"
            strokeDashoffset={animated ? 0 : 80}
            style={{ transition: "stroke-dashoffset 0.45s 0.35s ease, opacity 0.45s 0.35s ease", opacity: animated ? 1 : 0 }}
          />
        </svg>

        <p
          style={{
            margin: "0 0 12px",
            fontFamily: "var(--font-heading)", fontSize: "clamp(34px,8vw,52px)",
            fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.06em", lineHeight: 1.05,
          }}
        >
          Order Placed
        </p>
        {orderShort && (
          <p
            style={{
              margin: "0 0 10px",
              fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200,
              letterSpacing: "0.35em", textTransform: "uppercase",
              color: "rgba(200,144,58,0.8)",
            }}
          >
            Order #{orderShort}
          </p>
        )}
        <p
          style={{
            margin: "0 0 44px", maxWidth: 380,
            fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 200,
            letterSpacing: "0.05em", color: "rgba(240,223,200,0.5)", lineHeight: 1.7,
          }}
        >
          We&apos;ve sent a confirmation to your phone. We&apos;ll reach out shortly to finalise delivery details.
        </p>

        <Link
          href={orderId ? `/orders/${encodeURIComponent(orderId)}` : "/orders"}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "100%", maxWidth: 360, height: 56,
            background: "#f59e0b",
            textDecoration: "none",
            fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 400,
            letterSpacing: "0.4em", textTransform: "uppercase",
            color: "#080604",
            marginBottom: 14,
            WebkitTapHighlightColor: "transparent",
          }}
        >
          View Order
        </Link>
        <Link
          href="/shop"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "100%", maxWidth: 360, height: 48,
            background: "transparent",
            border: "1px solid rgba(240,223,200,0.18)",
            textDecoration: "none",
            fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
            letterSpacing: "0.4em", textTransform: "uppercase",
            color: "rgba(240,223,200,0.6)",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          Continue Shopping
        </Link>
      </main>
    </div>
  );
}
