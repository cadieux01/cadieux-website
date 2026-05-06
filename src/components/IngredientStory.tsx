"use client";

import { useRef, useEffect, useState } from "react";

/* ── Grain URI ── */
const GRAIN =
  "url(/grain.svg)";

/* ── Helpers ── */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const remap = (v: number, lo: number, hi: number) => clamp((v - lo) / (hi - lo), 0, 1);
const ease  = (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

/* ── Content ── */
const LINES = [
  "Most bread fills you up.",
  "Ours builds you up.",
  "Packed with 5 sources of real protein.",
  "Seeds that fuel. Grains that last.",
  "Fibre that works. Flavour that stays.",
  "This is not just bread.",
  "This is Cadieux.",
];

const INGREDIENTS = [
  { name: "Whey Protein",          desc: "Builds lean muscle and speeds up recovery" },
  { name: "Oat Protein",           desc: "Sustained energy with every bite" },
  { name: "Soya Protein",          desc: "Complete plant protein for daily strength" },
  { name: "Wheat Protein",         desc: "Natural gluten structure for lasting fullness" },
  { name: "Wheat Fibres",          desc: "Keeps your gut moving, naturally" },
  { name: "Sunflower Seeds",       desc: "Rich in vitamin E and healthy fats" },
  { name: "Sesame Seeds",          desc: "Tiny seeds, massive mineral content" },
  { name: "Linseeds",              desc: "Omega-3 powerhouse for heart and brain" },
  { name: "Soya Flour",            desc: "Boosts protein density in every slice" },
  { name: "Oat Bran",              desc: "Lowers cholesterol, feeds your gut bacteria" },
  { name: "Iodised Salt",          desc: "Essential minerals, perfectly balanced" },
  { name: "Rye Sourdough Ferment", desc: "Ancient fermentation for better digestion" },
  { name: "Barley Malt",           desc: "Natural sweetness with a low glycemic touch" },
  { name: "Wholemeal Flour",       desc: "Full grain nutrition, nothing stripped away" },
];

const CARD_BG = ["#0E0804", "#120A04", "#0A0804", "#140C06"];

/* ── Section progress state ── */
interface Measures {
  sy: number;
  linesTop: number; linesH: number;
  cardsTop: number; cardsH: number;
  wh: number;
}

export default function IngredientStory() {
  const linesRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  const [m, setM] = useState<Measures>({
    sy: 0, linesTop: 9999, linesH: 1, cardsTop: 99999, cardsH: 1, wh: 812,
  });

  useEffect(() => {
    let rafId: number;
    let lastSy = -1;

    const read = (sy: number): Measures => {
      const wh = window.innerHeight;
      let linesTop = 9999, linesH = 1, cardsTop = 99999, cardsH = 1;
      if (linesRef.current) {
        linesTop = sy + linesRef.current.getBoundingClientRect().top;
        linesH   = linesRef.current.scrollHeight;
      }
      if (cardsRef.current) {
        cardsTop = sy + cardsRef.current.getBoundingClientRect().top;
        cardsH   = cardsRef.current.scrollHeight;
      }
      return { sy, linesTop, linesH, cardsTop, cardsH, wh };
    };

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const sy = window.scrollY;
      if (sy !== lastSy) { lastSy = sy; setM(read(sy)); }
    };

    setM(read(window.scrollY));
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const { sy, linesTop, linesH, cardsTop, cardsH, wh } = m;
  const linesP = remap(sy - linesTop, 0, linesH - wh);
  const cardsP = remap(sy - cardsTop, 0, cardsH - wh);

  const N_L = LINES.length;       // 7
  const N_C = INGREDIENTS.length; // 14

  /* ── Per-line visibility ── */
  const lineVis = LINES.map((_, i) => {
    const f = linesP * N_L - i;
    // f: -0.5 entering → 0 fully in → 0.5 exiting → 1.0 gone
    let opacity = 0, ty = 42;
    if (f > -0.5 && f <= 0) {
      const t = ease(remap(f, -0.5, 0));
      opacity = t; ty = (1 - t) * 42;
    } else if (f > 0 && f <= 0.5) {
      opacity = 1; ty = 0;
    } else if (f > 0.5 && f < 1.1) {
      const t = ease(remap(f, 0.5, 1.1));
      opacity = 1 - t; ty = -t * 30;
    }
    return { opacity, ty };
  });

  /* ── Per-card visibility ── */
  const cardVis = INGREDIENTS.map((_, i) => {
    const f = cardsP * N_C - i;
    let opacity = 0, ty = 52;
    if (f > -0.5 && f <= 0) {
      const t = ease(remap(f, -0.5, 0));
      opacity = t; ty = (1 - t) * 52;
    } else if (f > 0 && f <= 0.5) {
      opacity = 1; ty = 0;
    } else if (f > 0.5 && f < 1.1) {
      const t = ease(remap(f, 0.5, 1.1));
      opacity = 1 - t; ty = -t * 40;
    }
    return { opacity, ty };
  });

  return (
    <div style={{ background: "#0E0804" }}>

      {/* ══════════════════════════════════════════
          OPENING LINES SECTION
          ══════════════════════════════════════════ */}
      <div ref={linesRef} style={{ position: "relative", height: `${N_L * 100}vh` }}>
        <div
          style={{
            position: "sticky", top: 0,
            height: "100dvh",
            background: "#0E0804",
            overflow: "hidden",
          }}
        >
          {/* Grain overlay */}
          <div style={{
            position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
            backgroundImage: GRAIN, opacity: 0.06,
          }} />

          {/* Lines */}
          {LINES.map((line, i) => {
            const { opacity, ty } = lineVis[i];
            return (
              <div
                key={i}
                aria-hidden={opacity < 0.1}
                style={{
                  position: "absolute",
                  top: "50%", left: 0, right: 0,
                  padding: "0 clamp(28px, 8vw, 96px)",
                  transform: `translateY(calc(-50% + ${ty}px))`,
                  opacity,
                  willChange: "transform, opacity",
                  textAlign: "center",
                  zIndex: i + 1,
                  pointerEvents: "none",
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-heading)",
                    fontSize: "clamp(30px, 7.5vw, 72px)",
                    fontWeight: 300,
                    color: "rgb(240,223,200)",
                    letterSpacing: "0.025em",
                    lineHeight: 1.15,
                  }}
                >
                  {line}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ══════════════════════════════════════════
          INGREDIENT CARDS SECTION
          ══════════════════════════════════════════ */}
      <div ref={cardsRef} style={{ position: "relative", height: `${N_C * 100}vh` }}>
        <div
          style={{
            position: "sticky", top: 0,
            height: "100dvh",
            overflow: "hidden",
            background: "#0E0804",
          }}
        >
          {/* Shared grain — rendered once, above all cards */}
          <div style={{
            position: "absolute", inset: 0, zIndex: 50, pointerEvents: "none",
            backgroundImage: GRAIN, opacity: 0.06,
          }} />

          {/* Cards */}
          {INGREDIENTS.map((ing, i) => {
            const { opacity, ty } = cardVis[i];
            const bg = CARD_BG[i % CARD_BG.length];

            return (
              <div
                key={i}
                style={{
                  position: "absolute", inset: 0,
                  background: bg,
                  opacity,
                  zIndex: i,
                  pointerEvents: "none",
                  willChange: "opacity",
                }}
              >
                {/* Content */}
                <div
                  style={{
                    position: "absolute",
                    top: "50%", left: 0, right: 0,
                    padding: "0 clamp(28px, 8vw, 80px)",
                    transform: `translateY(calc(-50% + ${ty}px))`,
                    willChange: "transform",
                    textAlign: "center",
                  }}
                >
                  {/* Counter */}
                  <p style={{
                    margin: "0 0 20px",
                    fontFamily: "var(--font-body)",
                    fontSize: 8,
                    fontWeight: 200,
                    letterSpacing: "0.5em",
                    textTransform: "uppercase",
                    color: "rgba(200,144,58,0.4)",
                  }}>
                    {String(i + 1).padStart(2, "0")} — {String(N_C).padStart(2, "0")}
                  </p>

                  {/* Ingredient name */}
                  <h2 style={{
                    margin: "0 0 22px",
                    fontFamily: "var(--font-heading)",
                    fontSize: "clamp(48px, 12vw, 96px)",
                    fontWeight: 300,
                    color: "rgb(240,223,200)",
                    letterSpacing: "0.01em",
                    lineHeight: 1,
                  }}>
                    {ing.name}
                  </h2>

                  {/* Amber rule */}
                  <div style={{
                    width: 28, height: 1,
                    background: "rgba(200,144,58,0.35)",
                    margin: "0 auto 22px",
                  }} />

                  {/* Description */}
                  <p style={{
                    margin: 0,
                    fontFamily: "var(--font-body)",
                    fontSize: 9,
                    fontWeight: 200,
                    letterSpacing: "0.4em",
                    textTransform: "uppercase",
                    color: "rgb(200,144,58)",
                    lineHeight: 1.9,
                  }}>
                    {ing.desc}
                  </p>
                </div>
              </div>
            );
          })}

          {/* Progress bar — bottom center */}
          <div style={{
            position: "absolute", bottom: 32, left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            display: "flex", alignItems: "center", gap: 6,
            pointerEvents: "none",
          }}>
            {INGREDIENTS.map((_, i) => {
              const { opacity } = cardVis[i];
              const active = opacity >= 0.5;
              return (
                <div
                  key={i}
                  style={{
                    width: active ? 16 : 4,
                    height: 1,
                    background: active ? "rgb(200,144,58)" : "rgba(200,144,58,0.22)",
                    transition: "width 0.4s cubic-bezier(0.22,1,0.36,1), background 0.4s",
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}
