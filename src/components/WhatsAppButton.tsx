"use client";

// Persistent WhatsApp contact button — homepage only, bottom-RIGHT.
//
// Mirrors the fixed control in the opposite corner (the SiteMusic mute
// toggle at bottom-left) so the homepage has one small round affordance
// on each side. Fixed, so it survives the homepage's long scroll.
//
// VERTICAL OFFSET, not bottom:20 like its left-hand twin. The bottom-right
// corner is already owned by FloatingCartButton (56px circle, bottom
// max(24px, safe-area + 20px)) whenever the cart is non-empty — and the
// cart FAB is NOT hidden on "/". Sitting flush in that corner would put
// the two on top of each other the moment a customer adds a loaf. We stack
// above the cart's slot unconditionally rather than reading cartCount:
// a position that depends on cart state would move under the user's
// thumb mid-session, and the empty-cart gap costs nothing.
//
// Horizontally this clears the left-hand button by the full width of the
// viewport minus two 20px gutters — at 375px the left control ends at x=62
// and this one starts at x=307.

import { usePathname } from "next/navigation";

// Country code is REQUIRED. wa.me/7093403747 without the 91 resolves to
// nothing on WhatsApp Desktop / Web — it only forgives the omission on a
// phone that can infer the country from the SIM.
const WHATSAPP_URL = "https://wa.me/917093403747";

const SIZE = 48;

export default function WhatsAppButton() {
  const pathname = usePathname();
  if (pathname !== "/") return null;

  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with Cadieux on WhatsApp"
      style={{
        position: "fixed",
        right: "max(20px, env(safe-area-inset-right))",
        bottom:
          "calc(max(24px, env(safe-area-inset-bottom) + 20px) + 68px)",
        width: SIZE,
        height: SIZE,
        borderRadius: "50%",
        background: "#25D366",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 8px 20px rgba(0,0,0,0.35)",
        textDecoration: "none",
        // Same FAB layer as FloatingCartButton on the project z-scale
        // (content 0 / sticky 10 / dropdown 20 / fab 30 / modal 40).
        zIndex: 30,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="#FFFFFF"
        aria-hidden
      >
        <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.47-1.76-1.65-2.05-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.01-1.04 2.48s1.06 2.87 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35z" />
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.23 8.23z" />
      </svg>
    </a>
  );
}
