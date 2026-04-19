"use client";

import { useRef, useEffect, useState } from "react";

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ease  = (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

type ItemType = "question" | "answer" | "line" | "dot";
interface Item { type: ItemType; text?: string; }

const ITEMS: Item[] = [
  { type: "question", text: "Why do you need protein?" },
  { type: "line" },
  { type: "answer",   text: "Protein is the foundation of every cell in your body. It repairs muscle, powers your immune system, and keeps you full for longer — without the crash." },
  { type: "line" },
  { type: "question", text: "Why protein bread?" },
  { type: "line" },
  { type: "answer",   text: "Most bread works against you. Cadieux works for you. Each slice delivers 7g of protein and 6g of fibre, made from real seeds and ancient grains — no Maida, no compromise. Just fuel that builds your muscles and keeps your gut thriving." },
  { type: "line" },
  { type: "question", text: "Who is this for?" },
  { type: "line" },
  { type: "answer",   text: "Everyone. Every day. For anyone ready to take one quiet step toward a stronger, happier body — starting with what is on their plate." },
  { type: "line" },
  { type: "dot" },
];

const N = ITEMS.length;           // 13
const SCROLL_VH = 10;             // outer height = 10 * 100vh

export default function QASection() {
  const outerRef = useRef<HTMLDivElement>(null);
  const [p, setP] = useState(0);

  useEffect(() => {
    let raf: number;
    let last = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const sy = window.scrollY;
      if (sy === last) return;
      last = sy;
      const el = outerRef.current;
      if (!el) return;
      const top = sy + el.getBoundingClientRect().top;
      const h   = el.scrollHeight;
      const wh  = window.innerHeight;
      setP(clamp((sy - top) / (h - wh), 0, 1));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* Each item gets an equal slice of [0,1].
     It fully appears at the midpoint of its slice.            */
  const vis = ITEMS.map((_, i) => {
    const start = i / N;
    const mid   = (i + 0.45) / N;
    return ease(clamp((p - start) / (mid - start), 0, 1));
  });

  /* Column drifts upward as scroll progresses */
  const colTY = (0.48 - p) * 120; // vh — starts 48vh below center, ends 72vh above

  return (
    <div
      ref={outerRef}
      style={{ position: "relative", height: `${SCROLL_VH * 100}vh` }}
    >
      {/* Grain overlay fixed within section */}
      <div style={{
        position: "sticky", top: 0, height: 0, zIndex: 0, pointerEvents: "none",
      }}>
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: "100dvh",
          backgroundImage: GRAIN, opacity: 0.055,
        }} />
      </div>

      {/* Sticky viewport */}
      <div style={{
        position: "sticky", top: 0,
        height: "100dvh", overflow: "hidden",
        background: "rgb(6,4,2)",
        marginTop: "-100dvh",           // overlay the grain div
        zIndex: 1,
      }}>
        {/* Grain */}
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none",
        }} />

        {/* Drifting content column */}
        <div style={{
          position: "absolute",
          top: "50%", left: 0, right: 0,
          transform: `translateY(calc(-50% + ${colTY}vh))`,
          willChange: "transform",
          padding: "0 28px",
          zIndex: 1,
        }}>
          <div style={{ maxWidth: 300, margin: "0 auto" }}>
            {ITEMS.map((item, i) => {
              const v = vis[i];

              if (item.type === "question") return (
                <div key={i} style={{
                  paddingTop: i === 0 ? 0 : 60,
                  opacity: v,
                  transform: `translateY(${(1 - v) * 20}px)`,
                  willChange: "opacity, transform",
                  textAlign: "center",
                }}>
                  <p style={{
                    margin: 0,
                    fontFamily: "var(--font-heading)",
                    fontSize: "clamp(28px, 7vw, 48px)",
                    fontWeight: 300,
                    color: "rgb(240,223,200)",
                    lineHeight: 1.2,
                  }}>{item.text}</p>
                </div>
              );

              if (item.type === "answer") return (
                <div key={i} style={{
                  paddingTop: 0,
                  opacity: v,
                  transform: `translateY(${(1 - v) * 16}px)`,
                  willChange: "opacity, transform",
                  textAlign: "center",
                }}>
                  <p style={{
                    margin: 0,
                    fontFamily: "var(--font-body)",
                    fontSize: 13, fontWeight: 200,
                    lineHeight: 1.8,
                    color: "rgba(240,223,200,0.6)",
                    letterSpacing: "0.02em",
                  }}>{item.text}</p>
                </div>
              );

              if (item.type === "line") return (
                <div key={i} style={{
                  width: 1,
                  height: v * 80,
                  background: "linear-gradient(rgb(200,144,58), rgba(200,144,58,0.3))",
                  margin: "0 auto",
                  willChange: "height",
                }} />
              );

              if (item.type === "dot") return (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "rgb(200,144,58)",
                  margin: "0 auto",
                  opacity: v,
                  willChange: "opacity",
                }} />
              );

              return null;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
