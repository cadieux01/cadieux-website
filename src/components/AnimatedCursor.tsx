"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

type AnimVariant = "magnetic" | "glow" | "spotlight";

const CLICKABLE =
  'a, button, [role="button"], label[for], summary, select, .cursor-pointer';

const GOLD = "#c9922e";

// Pure-animation cursor overlay (no images). Three variants, all GPU-friendly:
// every per-frame write is a transform or opacity, batched through GSAP's
// quickTo tickers (one tween created once, reused) and a single rAF for the
// instant dot. Hover transitions are short GSAP tweens. The native cursor is
// hidden by the global `body { cursor: none }`; we restore the I-beam on text
// fields via CSS (see globals.css, html.anim-cursor rules).
//
// Gating: desktop fine-pointer only, and reduced-motion bails entirely so the
// native cursor (globals.css reduced-motion → cursor:auto) shows instead.
export default function AnimatedCursor({ variant }: { variant: AnimVariant }) {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const root = document.documentElement;
    root.classList.add("anim-cursor");

    const dot = dotRef.current;
    const ring = ringRef.current;
    const glow = glowRef.current;
    const spot = spotRef.current;
    const layers = [dot, ring, glow, spot].filter(Boolean) as HTMLDivElement[];

    // Center every layer on its own coordinate so transforms place the layer's
    // middle at the pointer.
    layers.forEach((el) => gsap.set(el, { xPercent: -50, yPercent: -50 }));

    // Instant dot, coalesced to one write per frame.
    let px = window.innerWidth / 2;
    let py = window.innerHeight / 2;
    let rafId = 0;
    const flushDot = () => {
      rafId = 0;
      if (dot) gsap.set(dot, { x: px, y: py });
    };

    // Lagged followers — quickTo creates each tween once and reuses it.
    const ringX = ring ? gsap.quickTo(ring, "x", { duration: 0.55, ease: "power3.out" }) : null;
    const ringY = ring ? gsap.quickTo(ring, "y", { duration: 0.55, ease: "power3.out" }) : null;
    const glowX = glow ? gsap.quickTo(glow, "x", { duration: 0.5, ease: "power3.out" }) : null;
    const glowY = glow ? gsap.quickTo(glow, "y", { duration: 0.5, ease: "power3.out" }) : null;
    const spotX = spot ? gsap.quickTo(spot, "x", { duration: 0.4, ease: "power3.out" }) : null;
    const spotY = spot ? gsap.quickTo(spot, "y", { duration: 0.4, ease: "power3.out" }) : null;

    let hovered: Element | null = null;
    let glued = false; // magnetic: ring is wrapping an element, stop following
    let visible = false;

    const reveal = () => {
      if (visible || layers.length === 0) return;
      visible = true;
      // spotlight ring starts hidden; everything else fades to its rest opacity
      gsap.to(layers, {
        opacity: (i, el) =>
          el === ring && variant === "spotlight"
            ? 0
            : el === glow
              ? 0.6
              : el === spot
                ? 0.5
                : 1,
        duration: 0.3,
        ease: "power2.out",
      });
    };

    const applyHover = (el: Element | null) => {
      if (variant === "magnetic" && ring) {
        if (el) {
          const r = el.getBoundingClientRect();
          const pad = 6;
          glued = true;
          gsap.to(ring, {
            x: r.left + r.width / 2,
            y: r.top + r.height / 2,
            width: r.width + pad * 2,
            height: r.height + pad * 2,
            borderRadius: 10,
            borderColor: "rgba(201,146,46,0.9)",
            duration: 0.35,
            ease: "power3.out",
            overwrite: true,
          });
          if (dot) gsap.to(dot, { scale: 0.4, opacity: 0.6, duration: 0.3 });
        } else {
          glued = false;
          gsap.to(ring, {
            width: 38,
            height: 38,
            borderRadius: 999,
            borderColor: "rgba(201,146,46,0.5)",
            duration: 0.4,
            ease: "power3.out",
            overwrite: true,
          });
          if (dot) gsap.to(dot, { scale: 1, opacity: 1, duration: 0.3 });
          // snap follow back to the pointer immediately
          ringX?.(px);
          ringY?.(py);
        }
      } else if (variant === "glow" && glow) {
        gsap.to(glow, {
          scale: el ? 1.7 : 1,
          opacity: el ? 0.85 : 0.6,
          duration: 0.4,
          ease: "power2.out",
        });
      } else if (variant === "spotlight") {
        if (spot)
          gsap.to(spot, {
            scale: el ? 1.35 : 1,
            opacity: el ? 0.7 : 0.5,
            duration: 0.4,
            ease: "power2.out",
          });
        if (ring)
          gsap.to(ring, {
            scale: el ? 1 : 1.8,
            opacity: el ? 1 : 0,
            duration: el ? 0.4 : 0.25,
            ease: "power3.out",
            overwrite: true,
          });
      }
    };

    const onMove = (e: MouseEvent) => {
      px = e.clientX;
      py = e.clientY;
      if (dot && !rafId) rafId = requestAnimationFrame(flushDot);
      if (!glued) {
        ringX?.(px);
        ringY?.(py);
      }
      glowX?.(px);
      glowY?.(py);
      spotX?.(px);
      spotY?.(py);
      reveal();

      const target = e.target as Element | null;
      const clickable = target?.closest?.(CLICKABLE) ?? null;
      if (clickable !== hovered) {
        hovered = clickable;
        applyHover(clickable);
      }
    };

    const onLeave = () => {
      visible = false;
      gsap.to(layers, { opacity: 0, duration: 0.25, ease: "power2.out" });
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseleave", onLeave);

    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      if (rafId) cancelAnimationFrame(rafId);
      gsap.killTweensOf(layers);
      root.classList.remove("anim-cursor");
    };
  }, [variant]);

  const base: React.CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    pointerEvents: "none",
    zIndex: 9999,
    opacity: 0,
    willChange: "transform, opacity",
  };

  return (
    <>
      {/* magnetic + spotlight share a small gold dot */}
      {(variant === "magnetic" || variant === "spotlight") && (
        <div
          ref={dotRef}
          style={{
            ...base,
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: GOLD,
          }}
        />
      )}

      {/* magnetic ring (wraps on hover) */}
      {variant === "magnetic" && (
        <div
          ref={ringRef}
          style={{
            ...base,
            width: 38,
            height: 38,
            borderRadius: 999,
            border: "1px solid rgba(201,146,46,0.5)",
            boxSizing: "border-box",
          }}
        />
      )}

      {/* glow blob */}
      {variant === "glow" && (
        <div
          ref={glowRef}
          style={{
            ...base,
            width: 140,
            height: 140,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(201,146,46,0.55) 0%, rgba(201,146,46,0.22) 40%, rgba(201,146,46,0) 70%)",
            filter: "blur(6px)",
            mixBlendMode: "screen",
          }}
        />
      )}

      {/* spotlight: soft lightening disc + a thin gold ring that closes in */}
      {variant === "spotlight" && (
        <>
          <div
            ref={spotRef}
            style={{
              ...base,
              width: 180,
              height: 180,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(255,228,160,0.45) 0%, rgba(255,228,160,0.15) 45%, rgba(255,228,160,0) 72%)",
              mixBlendMode: "soft-light",
            }}
          />
          <div
            ref={ringRef}
            style={{
              ...base,
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: "1.5px solid rgba(201,146,46,0.85)",
              boxSizing: "border-box",
            }}
          />
        </>
      )}
    </>
  );
}
