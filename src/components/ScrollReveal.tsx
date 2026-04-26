"use client";

import { useEffect, useRef, useState } from "react";

/**
 * ScrollReveal — fade + slide a section into view as it enters the viewport.
 *
 *   <ScrollReveal>
 *     <h1 data-stagger>Hi</h1>
 *     <p data-stagger>Body</p>
 *   </ScrollReveal>
 *
 * Behavior:
 *   • IntersectionObserver (threshold 0.15) toggles `is-visible` once the
 *     section enters the viewport. After it fires we disconnect — the
 *     section stays visible if the user scrolls back past it (no flicker).
 *   • Direction-aware: when scrolling DOWN, the section slides up from
 *     +60px. When scrolling UP (e.g. user used Back button or scrolled
 *     back past a not-yet-revealed section), it slides down from -60px.
 *   • Children with `data-stagger` get an incremental 100ms delay so a
 *     heading lands first, then paragraph, then the next thing.
 *
 * Notes:
 *   • Lenis (mounted in <SmoothScroll />) drives the page scroll, so the
 *     IntersectionObserver fires against the native scroll position Lenis
 *     manipulates — no extra integration needed.
 *   • Respects `prefers-reduced-motion`.
 */

// Module-level scroll-direction tracker — one listener for the whole app.
let _dir: "down" | "up" = "down";
let _lastY = 0;
let _attached = false;
const ensureScrollListener = () => {
  if (_attached || typeof window === "undefined") return;
  _attached = true;
  _lastY = window.scrollY;
  window.addEventListener(
    "scroll",
    () => {
      const y = window.scrollY;
      if (y === _lastY) return;
      _dir = y > _lastY ? "down" : "up";
      _lastY = y;
    },
    { passive: true }
  );
};

type Props = {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** Extra px above/below where the IO should fire (default 0). */
  rootMargin?: string;
  /** When true, every reveal re-plays — default false (one-shot). */
  replay?: boolean;
};

export default function ScrollReveal({
  children,
  className = "",
  style,
  rootMargin = "0px",
  replay = false,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [direction, setDirection] = useState<"down" | "up">("down");

  useEffect(() => {
    ensureScrollListener();
    const el = ref.current;
    if (!el) return;

    // Honour reduced-motion: just show immediately.
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      setVisible(true);
      return;
    }

    // Set per-child stagger delay so CSS can read --stagger-delay.
    const kids = el.querySelectorAll<HTMLElement>("[data-stagger]");
    kids.forEach((kid, i) => {
      kid.style.setProperty("--stagger-delay", `${i * 100}ms`);
    });

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setDirection(_dir);
            setVisible(true);
            if (!replay) io.disconnect();
          } else if (replay) {
            setVisible(false);
          }
        });
      },
      { threshold: 0.15, rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [replay, rootMargin]);

  return (
    <div
      ref={ref}
      data-direction={direction}
      className={`scroll-reveal ${visible ? "is-visible" : ""} ${className}`.trim()}
      style={style}
    >
      {children}

      <style jsx global>{`
        .scroll-reveal {
          opacity: 0;
          transform: translateY(60px) scale(0.98);
          transition:
            opacity 1.2s cubic-bezier(0.19, 1, 0.22, 1),
            transform 1.2s cubic-bezier(0.19, 1, 0.22, 1);
          will-change: opacity, transform;
        }
        .scroll-reveal[data-direction="up"]:not(.is-visible) {
          transform: translateY(-60px) scale(0.98);
        }
        .scroll-reveal.is-visible {
          opacity: 1;
          transform: translateY(0) scale(1);
        }

        /* Staggered children — only animate when section becomes visible */
        .scroll-reveal [data-stagger] {
          opacity: 0;
          transform: translateY(20px);
          transition:
            opacity 0.9s cubic-bezier(0.19, 1, 0.22, 1) var(--stagger-delay, 0ms),
            transform 0.9s cubic-bezier(0.19, 1, 0.22, 1) var(--stagger-delay, 0ms);
          will-change: opacity, transform;
        }
        .scroll-reveal.is-visible [data-stagger] {
          opacity: 1;
          transform: translateY(0);
        }

        @media (prefers-reduced-motion: reduce) {
          .scroll-reveal,
          .scroll-reveal [data-stagger] {
            opacity: 1 !important;
            transform: none !important;
            transition: none !important;
          }
        }
      `}</style>
    </div>
  );
}
