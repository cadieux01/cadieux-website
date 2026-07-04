// Lightweight "fly to cart" animation. Spawns a small gold dot at the
// source element's center, arcs it to the floating cart button via a
// fixed-position transform transition, then removes the node and fires
// `cadieux:cart-bounce` so the floating button can pulse.
//
// Deliberately framework-free: no portal, no React state — just a temp
// DOM node on document.body so it survives any unmount of the source
// component (e.g. user navigates away mid-flight). If the floating cart
// is not currently mounted (e.g. /admin), we skip silently.

import { FLOATING_CART_ID } from "@/components/FloatingCartButton";

const DURATION_MS = 620;

export function flyToCart(source: HTMLElement | null): void {
  if (typeof window === "undefined") return;
  if (!source) return;
  // Respect users who opted out of motion.
  if (
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    window.dispatchEvent(new CustomEvent("cadieux:cart-bounce"));
    return;
  }
  const target = document.getElementById(FLOATING_CART_ID);
  if (!target) {
    // Cart button not yet visible (cart was empty pre-add) — the badge
    // will animate in on its own via the mount keyframe. Still fire the
    // bounce so listeners that mount mid-flight get the cue.
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("cadieux:cart-bounce"));
    }, DURATION_MS);
    return;
  }
  const srcRect = source.getBoundingClientRect();
  const dstRect = target.getBoundingClientRect();
  const sx = srcRect.left + srcRect.width / 2;
  const sy = srcRect.top + srcRect.height / 2;
  const dx = dstRect.left + dstRect.width / 2 - sx;
  const dy = dstRect.top + dstRect.height / 2 - sy;

  const dot = document.createElement("div");
  dot.setAttribute("aria-hidden", "true");
  Object.assign(dot.style, {
    position: "fixed",
    left: `${sx - 12}px`,
    top: `${sy - 12}px`,
    width: "24px",
    height: "24px",
    borderRadius: "50%",
    background:
      "radial-gradient(circle at 35% 30%, #f3dca6 0%, #024628 55%, #8b6d3a 100%)",
    boxShadow: "0 8px 18px rgba(201,169,110,0.45)",
    pointerEvents: "none",
    zIndex: "999",
    transform: "translate(0,0) scale(1)",
    opacity: "1",
    transition: `transform ${DURATION_MS}ms cubic-bezier(0.55, 0, 0.4, 1), opacity ${DURATION_MS}ms ease-in`,
    willChange: "transform, opacity",
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(dot);

  // Two rAFs ensures the browser commits the initial styles before the
  // transition target is applied — otherwise the dot teleports without
  // animating. Standard pattern for "start CSS transition on mount".
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      dot.style.transform = `translate(${dx}px, ${dy}px) scale(0.35)`;
      dot.style.opacity = "0.4";
    });
  });

  window.setTimeout(() => {
    dot.remove();
    window.dispatchEvent(new CustomEvent("cadieux:cart-bounce"));
  }, DURATION_MS);
}
