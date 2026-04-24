"use client";

import { useEffect } from "react";

/**
 * Global edge-swipe navigation (mobile).
 *
 * Swipe inward from the LEFT edge of the viewport  → history.back()
 * Swipe inward from the RIGHT edge of the viewport → history.forward()
 *
 * Mirrors the iOS / modern browser pattern so the whole site feels native
 * without needing to tap the ← back link in the top corner.
 */
export default function EdgeSwipeNav() {
  useEffect(() => {
    const EDGE = 24;          // px from the edge that counts as an "edge" start
    const MIN_DX = 70;        // px the finger must travel inward
    const MAX_DY = 80;        // vertical tolerance — keep gesture mostly horizontal
    const MAX_DURATION = 700; // ms — anything slower than this is treated as a pan, not a swipe

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let origin: null | "left" | "right" = null;

    // If the touch started on (or inside) an element that itself scrolls
    // horizontally — like a product-tile gallery or the PDP media swiper —
    // the user is swiping content, not the page. Don't hijack it as a
    // history.back() / forward().
    const startedOnHScroller = (target: EventTarget | null) => {
      let el = target as HTMLElement | null;
      while (el && el !== document.body) {
        const cs = window.getComputedStyle(el);
        const ox = cs.overflowX;
        if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 1) {
          return true;
        }
        el = el.parentElement;
      }
      return false;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        origin = null;
        return;
      }
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startTime = Date.now();

      let candidate: null | "left" | "right" = null;
      if (startX <= EDGE) candidate = "left";
      else if (startX >= window.innerWidth - EDGE) candidate = "right";

      if (candidate && startedOnHScroller(e.target)) {
        candidate = null;
      }
      origin = candidate;
    };

    const onEnd = (e: TouchEvent) => {
      if (!origin) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const dt = Date.now() - startTime;

      if (dt <= MAX_DURATION && Math.abs(dy) <= MAX_DY) {
        if (origin === "left" && dx >= MIN_DX) {
          window.history.back();
        } else if (origin === "right" && dx <= -MIN_DX) {
          window.history.forward();
        }
      }
      origin = null;
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", () => { origin = null; }, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, []);

  return null;
}
