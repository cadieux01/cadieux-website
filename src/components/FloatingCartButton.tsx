"use client";

// Global floating cart button — replaces the old inline stepper + "View Cart"
// per-card UX with a single persistent target in the bottom-right corner.
//
//   - Mounts inside CartProvider (see app/layout.tsx) so it can read the
//     live item count for its badge.
//   - Hides on /admin (not customer-facing), and on /cart + /checkout
//     where it would either duplicate or overlap the page's own primary
//     CTAs.
//   - Exposes a known DOM id (FLOATING_CART_ID) so the fly-to-cart
//     animation can target its on-screen coords from anywhere.
//   - Listens for `cadieux:cart-bounce` and plays a short pulse so the
//     user gets a clear "landed" cue when an item flies in.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useCart } from "@/context/CartContext";

export const FLOATING_CART_ID = "cadieux-floating-cart";

const HIDDEN_PREFIXES = ["/admin", "/cart", "/checkout"];

export default function FloatingCartButton() {
  const { cartCount } = useCart();
  const pathname = usePathname();
  const [bouncing, setBouncing] = useState(false);
  // Wait until after first client paint to render — keeps SSR markup
  // empty (no cart count flash) and avoids hydration mismatches on the
  // bounce class.
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const onBounce = () => {
      setBouncing(true);
      window.setTimeout(() => setBouncing(false), 420);
    };
    window.addEventListener("cadieux:cart-bounce", onBounce);
    return () => window.removeEventListener("cadieux:cart-bounce", onBounce);
  }, [mounted]);

  if (!mounted) return null;
  if (cartCount <= 0) return null;
  if (pathname && HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) {
    return null;
  }

  return (
    <>
      <style>{`
        @keyframes cdx-fcb-pulse {
          0%   { transform: scale(1); box-shadow: 0 12px 28px rgba(0,0,0,0.4), 0 0 0 0 rgba(2,70,40,0.45); }
          40%  { transform: scale(1.12); box-shadow: 0 14px 32px rgba(0,0,0,0.45), 0 0 0 12px rgba(2,70,40,0); }
          100% { transform: scale(1); box-shadow: 0 12px 28px rgba(0,0,0,0.4), 0 0 0 0 rgba(2,70,40,0); }
        }
        @keyframes cdx-fcb-in {
          from { opacity: 0; transform: translateY(8px) scale(0.9); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <Link
        href="/cart"
        id={FLOATING_CART_ID}
        aria-label={`View cart (${cartCount} ${cartCount === 1 ? "item" : "items"})`}
        style={{
          position: "fixed",
          right: "max(20px, env(safe-area-inset-right))",
          bottom: "max(24px, calc(env(safe-area-inset-bottom) + 20px))",
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "#024628",
          color: "#c0c8ce",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 12px 28px rgba(0,0,0,0.4)",
          textDecoration: "none",
          // FAB layer on the Task F v2 z-scale (content 0 / sticky 10 / dropdown 20 / fab 30 / modal 40 / toast 50)
          zIndex: 30,
          // Pulse fires on cart-bounce; the lighter `cdx-fcb-in` only on
          // mount keeps the button from popping in abruptly when the cart
          // first becomes non-empty.
          animation: bouncing
            ? "cdx-fcb-pulse 0.42s ease-out"
            : "cdx-fcb-in 0.25s ease-out",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="9" cy="20" r="1.4" />
          <circle cx="17" cy="20" r="1.4" />
          <path d="M3 4h2.2l2 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L20.4 8H6.4" />
        </svg>
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: -4,
            right: -4,
            minWidth: 22,
            height: 22,
            padding: "0 6px",
            borderRadius: 999,
            background: "#024628",
            color: "#FBF3D4",
            border: "1.5px solid #024628",
            fontFamily: "var(--font-body)",
            fontSize: 11,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
            letterSpacing: 0,
          }}
        >
          {cartCount > 99 ? "99+" : cartCount}
        </span>
      </Link>
    </>
  );
}
