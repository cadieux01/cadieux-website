"use client";

import { useEffect } from "react";

import type { CursorVariant } from "@/lib/cursor-config";

// CSS-driven bread cursor (variants v1/v2/v3).
//
// The cursor IMAGE swap is pure CSS — a class on <html> drives native
// `cursor: url()` rules (see globals.css), so it costs zero per-frame JS and
// never touches scroll/click precision. Desktop-only and reduced-motion
// gating live in the CSS media query; this component only:
//   1. toggles the variant class on <html>, and
//   2. for v3, runs a light, rAF-batched, reduced-motion-gated crumb trail.
export default function BreadCursor({
  variant,
}: {
  variant: Exclude<CursorVariant, "classic">;
}) {
  // Toggle the variant class on <html>. The CSS does the rest.
  useEffect(() => {
    const root = document.documentElement;
    const cls = `bread-cursor-${variant}`;
    root.classList.add(cls);
    return () => root.classList.remove(cls);
  }, [variant]);

  // v3 only: trailing crumbs. Bails on reduced-motion or coarse pointers so
  // it never runs where it shouldn't, and throttles by time + distance so it
  // stays performance-light.
  useEffect(() => {
    if (variant !== "v3") return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const layer = document.createElement("div");
    layer.setAttribute("data-bread-crumbs", "");
    layer.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:9998;";
    document.body.appendChild(layer);

    const MIN_INTERVAL = 55; // ms between crumbs
    const MIN_DIST = 16; // px the pointer must travel before another crumb
    const MAX_CRUMBS = 24; // hard cap on concurrent crumbs
    let lastSpawn = 0;
    let lastX = Number.NEGATIVE_INFINITY;
    let lastY = Number.NEGATIVE_INFINITY;
    let queued = false;

    const spawn = (x: number, y: number) => {
      if (layer.childElementCount >= MAX_CRUMBS) {
        layer.firstElementChild?.remove();
      }
      const crumb = document.createElement("span");
      crumb.className = "bread-crumb";
      const size = 3 + Math.random() * 3;
      crumb.style.left = `${x + (Math.random() - 0.5) * 6}px`;
      crumb.style.top = `${y + (Math.random() - 0.5) * 6}px`;
      crumb.style.width = `${size}px`;
      crumb.style.height = `${size}px`;
      crumb.addEventListener("animationend", () => crumb.remove(), {
        once: true,
      });
      // Safety GC if animationend is ever missed (tab blur, etc.)
      window.setTimeout(() => crumb.remove(), 1200);
      layer.appendChild(crumb);
    };

    const onMove = (e: MouseEvent) => {
      const now = performance.now();
      const dist = Math.hypot(e.clientX - lastX, e.clientY - lastY);
      if (now - lastSpawn < MIN_INTERVAL || dist < MIN_DIST) return;
      lastSpawn = now;
      lastX = e.clientX;
      lastY = e.clientY;
      if (queued) return;
      queued = true;
      const x = e.clientX;
      const y = e.clientY;
      requestAnimationFrame(() => {
        queued = false;
        spawn(x, y);
      });
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      layer.remove();
    };
  }, [variant]);

  return null;
}
