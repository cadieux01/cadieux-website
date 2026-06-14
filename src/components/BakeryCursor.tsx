"use client";

import { useEffect } from "react";
import gsap from "gsap";

import type { BAKERY_VARIANTS } from "@/lib/cursor-config";

type BakeryVariant = (typeof BAKERY_VARIANTS)[number];

const CLICKABLE =
  'a, button, [role="button"], label[for], summary, select, .cursor-pointer';

const GOLD = "#c9922e";
const CRUST = "#b9772c";
const CREAM = "#f5e6c8";

// Bakery-themed animated cursors (no images). Everything is drawn on a single
// fixed overlay and animated with transform/opacity only, via GSAP — either a
// shared ticker (dough, ribbon) or short tweens fired on move/click (flour,
// knead, steam). Particle/segment counts are capped and every spawned node
// self-removes. The native pointer stays hidden by the global
// `body { cursor: none }`; the I-beam on text fields is restored via the
// html.anim-cursor CSS rules in globals.css.
//
// Gating: desktop fine-pointer only; reduced-motion bails entirely so the
// native cursor shows instead.
export default function BakeryCursor({ variant }: { variant: BakeryVariant }) {
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const root = document.documentElement;
    root.classList.add("anim-cursor");

    const layer = document.createElement("div");
    layer.setAttribute("data-bakery-cursor", variant);
    layer.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:9999;opacity:0;";
    document.body.appendChild(layer);

    let px = window.innerWidth / 2;
    let py = window.innerHeight / 2;
    let seenMove = false;

    const mk = (css: string) => {
      const el = document.createElement("div");
      el.style.cssText = css;
      layer.appendChild(el);
      return el;
    };

    // Common: reveal the overlay on first move, hide when the pointer leaves.
    const reveal = () => {
      if (seenMove) return;
      seenMove = true;
      gsap.to(layer, { opacity: 1, duration: 0.3, ease: "power2.out" });
    };
    const onLeave = () =>
      gsap.to(layer, { opacity: 0, duration: 0.25, ease: "power2.out" });
    const onEnter = () =>
      gsap.to(layer, { opacity: 1, duration: 0.25, ease: "power2.out" });

    const cleanups: Array<() => void> = [];
    const addMove = (fn: (e: MouseEvent) => void) => {
      window.addEventListener("mousemove", fn, { passive: true });
      cleanups.push(() => window.removeEventListener("mousemove", fn));
    };
    const addClick = (fn: (e: MouseEvent) => void) => {
      window.addEventListener("click", fn, { passive: true });
      cleanups.push(() => window.removeEventListener("click", fn));
    };
    const addTick = (fn: (t: number, dt: number) => void) => {
      gsap.ticker.add(fn);
      cleanups.push(() => gsap.ticker.remove(fn));
    };

    document.addEventListener("mouseleave", onLeave);
    document.addEventListener("mouseenter", onEnter);
    cleanups.push(() => {
      document.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("mouseenter", onEnter);
    });

    // ── dough: elastic stretch/squish along velocity, springs back round ────
    if (variant === "dough") {
      const dot = mk(
        `position:fixed;top:0;left:0;width:16px;height:16px;border-radius:50%;background:${GOLD};will-change:transform;`,
      );
      gsap.set(dot, { xPercent: -50, yPercent: -50, x: px, y: py });
      let rx = px;
      let ry = py;
      let sx = 1;
      let sy = 1;
      addMove((e) => {
        px = e.clientX;
        py = e.clientY;
        reveal();
      });
      addTick(() => {
        // Lag the rendered position; the gap between pointer and dot IS the
        // velocity, which drives the stretch — fast moves = bigger gap.
        const dx = px - rx;
        const dy = py - ry;
        rx += dx * 0.32;
        ry += dy * 0.32;
        const speed = Math.hypot(dx, dy);
        const stretch = Math.min(speed * 0.022, 0.85);
        const tx = 1 + stretch; // along movement
        const ty = 1 - stretch * 0.6; // perpendicular squish
        sx += (tx - sx) * 0.25;
        sy += (ty - sy) * 0.25;
        const angle = speed > 0.5 ? (Math.atan2(dy, dx) * 180) / Math.PI : 0;
        gsap.set(dot, {
          x: rx,
          y: ry,
          rotation: speed > 0.5 ? angle : "+=0",
          scaleX: sx,
          scaleY: sy,
        });
      });
    }

    // ── flour: a puff of cream particles bursts on click ────────────────────
    if (variant === "flour") {
      const dot = mk(
        `position:fixed;top:0;left:0;width:9px;height:9px;border-radius:50%;background:${GOLD};will-change:transform;`,
      );
      gsap.set(dot, { xPercent: -50, yPercent: -50, x: px, y: py });
      const dotX = gsap.quickTo(dot, "x", { duration: 0.18, ease: "power2.out" });
      const dotY = gsap.quickTo(dot, "y", { duration: 0.18, ease: "power2.out" });
      addMove((e) => {
        px = e.clientX;
        py = e.clientY;
        dotX(px);
        dotY(py);
        reveal();
      });

      const MAX = 90;
      addClick((e) => {
        if (layer.childElementCount > MAX) return;
        const n = 10 + Math.floor(Math.random() * 5);
        for (let i = 0; i < n; i++) {
          const size = 4 + Math.random() * 6;
          const p = mk(
            `position:fixed;top:0;left:0;width:${size}px;height:${size}px;border-radius:50%;background:${CREAM};will-change:transform,opacity;`,
          );
          const ang = Math.random() * Math.PI * 2;
          const dist = 14 + Math.random() * 34;
          gsap.set(p, {
            xPercent: -50,
            yPercent: -50,
            x: e.clientX,
            y: e.clientY,
            opacity: 0.85,
          });
          gsap.to(p, {
            x: e.clientX + Math.cos(ang) * dist,
            y: e.clientY + Math.sin(ang) * dist - (18 + Math.random() * 26),
            scale: 0.3,
            opacity: 0,
            duration: 0.6 + Math.random() * 0.45,
            ease: "power2.out",
            onComplete: () => p.remove(),
          });
        }
      });
    }

    // ── ribbon: a tapering golden crust-trail follow-chain ──────────────────
    if (variant === "ribbon") {
      const N = 22;
      const nodes: HTMLDivElement[] = [];
      const xs = new Array<number>(N).fill(px);
      const ys = new Array<number>(N).fill(py);
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const size = 14 - t * 11;
        const col = i < N * 0.5 ? GOLD : CRUST;
        const node = mk(
          `position:fixed;top:0;left:0;width:${size}px;height:${size}px;border-radius:50%;background:${col};opacity:${(1 - t) * 0.9};will-change:transform;`,
        );
        gsap.set(node, { xPercent: -50, yPercent: -50, x: px, y: py });
        nodes.push(node);
      }
      addMove((e) => {
        px = e.clientX;
        py = e.clientY;
        reveal();
      });
      addTick(() => {
        xs[0] += (px - xs[0]) * 0.4;
        ys[0] += (py - ys[0]) * 0.4;
        for (let i = 1; i < N; i++) {
          xs[i] += (xs[i - 1] - xs[i]) * 0.42;
          ys[i] += (ys[i - 1] - ys[i]) * 0.42;
        }
        for (let i = 0; i < N; i++) {
          gsap.set(nodes[i], { x: xs[i], y: ys[i] });
        }
      });
    }

    // ── knead: cursor rises over clickables; soft ripple on click ───────────
    if (variant === "knead") {
      const disc = mk(
        `position:fixed;top:0;left:0;width:34px;height:34px;border-radius:50%;background:radial-gradient(circle, rgba(201,146,46,0.30) 0%, rgba(201,146,46,0) 70%);will-change:transform;`,
      );
      const dot = mk(
        `position:fixed;top:0;left:0;width:10px;height:10px;border-radius:50%;background:${GOLD};will-change:transform;`,
      );
      [disc, dot].forEach((el) =>
        gsap.set(el, { xPercent: -50, yPercent: -50, x: px, y: py }),
      );
      const dx = gsap.quickTo(dot, "x", { duration: 0.16, ease: "power2.out" });
      const dy = gsap.quickTo(dot, "y", { duration: 0.16, ease: "power2.out" });
      const cx = gsap.quickTo(disc, "x", { duration: 0.28, ease: "power3.out" });
      const cy = gsap.quickTo(disc, "y", { duration: 0.28, ease: "power3.out" });
      let hovered: Element | null = null;
      addMove((e) => {
        px = e.clientX;
        py = e.clientY;
        dx(px);
        dy(py);
        cx(px);
        cy(py);
        reveal();
        const clickable =
          (e.target as Element | null)?.closest?.(CLICKABLE) ?? null;
        if (clickable !== hovered) {
          hovered = clickable;
          gsap.to(dot, {
            scale: clickable ? 1.7 : 1,
            duration: 0.35,
            ease: "power3.out",
          });
          gsap.to(disc, {
            scale: clickable ? 1.7 : 1,
            duration: 0.4,
            ease: "power3.out",
          });
        }
      });
      addClick((e) => {
        const ripple = mk(
          `position:fixed;top:0;left:0;width:30px;height:30px;border-radius:50%;border:2px solid rgba(201,146,46,0.7);will-change:transform,opacity;`,
        );
        gsap.set(ripple, {
          xPercent: -50,
          yPercent: -50,
          x: e.clientX,
          y: e.clientY,
          scale: 0.3,
          opacity: 0.9,
        });
        gsap.to(ripple, {
          scale: 3,
          opacity: 0,
          duration: 0.7,
          ease: "power2.out",
          onComplete: () => ripple.remove(),
        });
      });
    }

    // ── steam: warm wisps curl up from the pointer as it moves ──────────────
    if (variant === "steam") {
      const dot = mk(
        `position:fixed;top:0;left:0;width:8px;height:8px;border-radius:50%;background:${GOLD};opacity:0.85;will-change:transform;`,
      );
      gsap.set(dot, { xPercent: -50, yPercent: -50, x: px, y: py });
      const dx = gsap.quickTo(dot, "x", { duration: 0.16, ease: "power2.out" });
      const dy = gsap.quickTo(dot, "y", { duration: 0.16, ease: "power2.out" });

      const MAX = 60;
      let lastSpawn = 0;
      let lx = px;
      let ly = py;
      addMove((e) => {
        px = e.clientX;
        py = e.clientY;
        dx(px);
        dy(py);
        reveal();
        const now = performance.now();
        const moved = Math.hypot(px - lx, py - ly);
        if (now - lastSpawn < 70 || moved < 12) return;
        if (layer.childElementCount > MAX) return;
        lastSpawn = now;
        lx = px;
        ly = py;
        const size = 9 + Math.random() * 9;
        const wisp = mk(
          `position:fixed;top:0;left:0;width:${size}px;height:${size}px;border-radius:50%;background:radial-gradient(circle, rgba(245,230,200,0.5) 0%, rgba(245,230,200,0) 70%);filter:blur(2px);will-change:transform,opacity;`,
        );
        const drift = (Math.random() - 0.5) * 26;
        gsap.set(wisp, {
          xPercent: -50,
          yPercent: -50,
          x: px,
          y: py,
          opacity: 0.6,
        });
        gsap.to(wisp, {
          // gentle S-curl as it rises
          keyframes: {
            x: [px + drift * 0.4, px + drift, px + drift * 0.5],
            y: [py - 18, py - 42, py - 70],
            easeEach: "sine.inOut",
          },
          scale: 1.8,
          opacity: 0,
          duration: 1.1 + Math.random() * 0.5,
          ease: "power1.out",
          onComplete: () => wisp.remove(),
        });
      });
    }

    return () => {
      cleanups.forEach((fn) => fn());
      gsap.killTweensOf(layer.querySelectorAll("*"));
      layer.remove();
      root.classList.remove("anim-cursor");
    };
  }, [variant]);

  return null;
}
