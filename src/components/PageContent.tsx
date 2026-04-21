"use client";

import { useRef, useEffect, useState } from "react";
import QASection from "./QASection";

/* ── Helpers ── */
const sr    = (s: number) => { const x = Math.sin(s) * 43758.5453; return x - Math.floor(x); };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const remap = (v: number, lo: number, hi: number) => clamp((v - lo) / (hi - lo), 0, 1);
const ease  = (t: number) => t < 0.5 ? 2*t*t : -1+(4-2*t)*t;

/* ── SVG grain texture ── */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/* ── Content ── */
const INGREDIENTS = [
  { name: "Whey Protein",          desc: "Builds lean muscle and speeds up recovery" },
  { name: "Oat Protein",           desc: "Sustained energy with every bite" },
  { name: "Rye Sourdough Ferment", desc: "Ancient fermentation for better digestion" },
  { name: "Linseeds",              desc: "Omega-3 powerhouse for heart and brain" },
  { name: "Oat Bran",              desc: "Lowers cholesterol, feeds your gut bacteria" },
  { name: "Sunflower Seeds",       desc: "Rich in vitamin E and healthy fats" },
  { name: "Sesame Seeds",          desc: "Tiny seeds, massive mineral content" },
  { name: "Barley Malt",           desc: "Natural sweetness with a low glycemic touch" },
];

const CARD_BG = ["#1D1D1F", "#1F1F21", "#1B1B1D", "#212123"];

/* ── Deterministic floating grain data ── */
const GRAINS = Array.from({ length: 22 }, (_, i) => ({
  id:    i,
  x:     sr(i * 13 + 1) * 88,
  y:     sr(i * 13 + 2) * 95,
  size:  44 + sr(i * 13 + 3) * 46,
  rot:   sr(i * 13 + 4) * 360,
  op:    0.07 + sr(i * 13 + 5) * 0.07,
  dur:   8  + sr(i * 13 + 6) * 12,
  delay: sr(i * 13 + 7) * 8,
  anim:  i % 2 === 0 ? "grain-float" : "grain-sway",
}));

const N_C = INGREDIENTS.length;

export default function PageContent() {
  const grainRefs     = useRef<(HTMLImageElement | null)[]>([]);
  const cardsOuterRef = useRef<HTMLDivElement>(null);
  const videoRef      = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.play().catch(() => {});
  }, []);

  /* ── Scroll-driven card progress ── */
  const [cardsP, setCardsP] = useState(0);

  useEffect(() => {
    let rafId: number;
    let last = -1;
    // Cache layout values — only recalculate on resize, not every frame
    let cachedTop = 0, cachedH = 0, cachedWh = 0;
    const measure = () => {
      const el = cardsOuterRef.current;
      if (!el) return;
      cachedTop = window.scrollY + el.getBoundingClientRect().top;
      cachedH   = el.scrollHeight;
      cachedWh  = window.innerHeight;
    };
    measure();
    window.addEventListener("resize", measure, { passive: true });

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const sy = window.scrollY;
      if (sy === last) return;
      last = sy;
      setCardsP(clamp((sy - cachedTop) / (cachedH - cachedWh), 0, 1));
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", measure);
    };
  }, []);

  /* ── Grains — opacity boost on viewport entry ── */
  useEffect(() => {
    const io = new IntersectionObserver(
      entries => entries.forEach(e => {
        const el = e.target as HTMLImageElement;
        const base = parseFloat(el.dataset.op ?? "0.08");
        el.style.opacity = e.isIntersecting ? String(Math.min(0.18, base + 0.06)) : String(base);
      }),
      { threshold: 0.1 }
    );
    grainRefs.current.forEach(el => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  /* ── Per-card visibility from scroll progress ── */
  const cardVis = INGREDIENTS.map((_, i) => {
    const f = cardsP * N_C - i;
    let opacity = 0, tx = 80, ty = 80;
    if (f > -0.5 && f <= 0) {
      const t = ease(remap(f, -0.5, 0));
      opacity = t; tx = (1 - t) * 80; ty = (1 - t) * 80;
    } else if (f > 0 && f <= 0.5) {
      opacity = 1; tx = 0; ty = 0;
    } else if (f > 0.5 && f < 1.1) {
      const t = ease(remap(f, 0.5, 1.1));
      opacity = 1 - t; tx = -t * 80; ty = -t * 80;
    }
    return { opacity, tx, ty };
  });

  const activeCard = Math.round(clamp(cardsP * N_C - 0.5, 0, N_C - 1));

  return (
    <>
      <style>{`
        @keyframes grain-float {
          0%,100% { transform: translateY(0px)   rotate(var(--gr)); }
          50%      { transform: translateY(-26px) rotate(calc(var(--gr) + 5deg)); }
        }
        @keyframes grain-sway {
          0%,100% { transform: translateX(0px)   rotate(var(--gr)); }
          50%      { transform: translateX(15px)  rotate(calc(var(--gr) - 7deg)); }
        }

      `}</style>

      <div style={{ position: "relative", background: "#1D1D1F", overflowX: "clip" }}>

        {/* ── Floating grain layer ── */}
        <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }}>
          {GRAINS.map((g, i) => (
            <img
              key={g.id}
              ref={el => { grainRefs.current[i] = el; }}
              src="/grains.png"
              alt=""
              data-op={g.op.toFixed(3)}
              style={{
                position: "absolute",
                left: `${g.x}%`, top: `${g.y}%`,
                width: g.size, height: g.size,
                objectFit: "cover",
                opacity: g.op,
                mixBlendMode: "screen",
                animationName: g.anim,
                animationDuration: `${g.dur}s`,
                animationDelay: `${-g.delay}s`,
                animationTimingFunction: "ease-in-out",
                animationIterationCount: "infinite",
                transition: "opacity 0.6s ease",
                "--gr": `${g.rot}deg`,
              } as React.CSSProperties}
            />
          ))}
        </div>

        <div style={{ position: "relative", zIndex: 1 }}>

          {/* ══ SECTION 1 — VIDEO ══ */}
          <div style={{ position: "relative", height: "100dvh" }}>
            <section style={{
              position: "absolute", inset: 0, overflow: "hidden",
              display: "flex", flexDirection: "column", justifyContent: "flex-start",
              maskImage: "linear-gradient(to bottom, black 45%, transparent 88%)",
              WebkitMaskImage: "linear-gradient(to bottom, black 45%, transparent 88%)",
            }}>
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                preload="auto"
                loop
                poster="/hero.jpg"
                style={{
                  position: "absolute", inset: 0,
                  width: "100%", height: "100%",
                  objectFit: "cover",
                  zIndex: 1,
                  filter: "brightness(1) contrast(1)",
                }}
              >
                <source src="/bread-intro.mp4" type="video/mp4" />
              </video>
              <div style={{
                position: "absolute", inset: 0, zIndex: 2,
                background: "radial-gradient(ellipse at center, transparent 40%, rgba(29,29,31,0.6) 100%)",
                pointerEvents: "none",
              }} />
              {/* Bold statement — top left */}
              <div style={{
                position: "relative", zIndex: 3,
                paddingLeft: "clamp(28px, 8vw, 80px)",
                paddingRight: "clamp(28px, 8vw, 80px)",
                paddingTop: "clamp(80px, 18vh, 160px)",
              }}>
                <p style={{
                  margin: "0 0 16px",
                  fontFamily: "var(--font-body)", fontSize: 10,
                  fontWeight: 200, letterSpacing: "0.45em", textTransform: "uppercase",
                  color: "#FBF3D4", pointerEvents: "none",
                }}>Cadieux</p>
                <p style={{
                  margin: 0,
                  fontFamily: "var(--font-heading)",
                  fontSize: "clamp(40px, 10vw, 88px)",
                  fontWeight: 600,
                  color: "#FBF3D4",
                  lineHeight: 1.1,
                  letterSpacing: "0.02em",
                  textShadow: "0 2px 40px rgba(0,0,0,0.6)",
                  pointerEvents: "none",
                }}>
                  Same Routine.<br />Better Protein.
                </p>
              </div>
            </section>
            {/* Shop Now — bottom right, outside masked section so it stays visible */}
            <button
              onClick={() => window.dispatchEvent(new Event("openShop"))}
              style={{
                position: "absolute", bottom: 48, right: "clamp(28px, 8vw, 80px)", zIndex: 4,
                fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
                letterSpacing: "0.4em", textTransform: "uppercase",
                color: "#FBF3D4", background: "#024628",
                border: "none", padding: "10px 24px", cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}>Shop Now</button>
          </div>

          {/* Phase 1→2 bridge: fades Phase 1 bottom to dark, matching Phase 2's video overlay */}
          <div style={{
            position: "relative", marginTop: "-35vh", height: "35vh",
            zIndex: 2, pointerEvents: "none",
            background: "linear-gradient(to bottom, transparent, #060402)",
          }} />

          {/* ══ Q&A SECTION ══ */}
          <QASection />

          {/* Phase 2→3 bridge */}
          <div style={{
            position: "relative", marginTop: "-28vh", height: "28vh",
            zIndex: 50, pointerEvents: "none",
            background: "linear-gradient(to bottom, #1D1D1F, transparent)",
          }} />

          {/* ══ SECTION 4 — INGREDIENT CARDS (scroll-driven sticky) ══ */}
          <div ref={cardsOuterRef} style={{ position: "relative", height: `${N_C * 100}vh` }}>
            <div style={{
              position: "sticky", top: 0, height: "100dvh", overflow: "hidden",
              background: "#1D1D1F",
            }}>
              {/* Background video */}
              <video
                autoPlay muted playsInline loop
                style={{
                  position: "absolute", inset: 0,
                  width: "100%", height: "100%",
                  objectFit: "cover", zIndex: 0,
                }}
              >
                <source src="/product-video-05.mp4" type="video/mp4" />
              </video>
              {/* Dark overlay */}
              <div style={{ position: "absolute", inset: 0, background: "rgba(6,4,2,0.62)", zIndex: 0, pointerEvents: "none" }} />
              {/* Phase 3→4 bottom blend */}
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                height: "25vh", zIndex: 12, pointerEvents: "none",
                background: "linear-gradient(to bottom, transparent, #1D1D1F)",
              }} />
              {/* Shared grain overlay */}
              <div style={{ position: "absolute", inset: 0, zIndex: 10, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none" }} />

              {/* Static heading */}
              <p style={{
                position: "absolute", top: "18%", left: 0, right: 0, zIndex: 20,
                textAlign: "center", margin: 0,
                fontFamily: "var(--font-heading)", fontSize: "clamp(28px,6vw,48px)", fontWeight: 300,
                letterSpacing: "0.08em",
                color: "#FBF3D4",
                opacity: Math.max(0, 1 - clamp((cardsP - 0.7) / 0.3, 0, 1)) * 0.75,
                pointerEvents: "none",
                transition: "opacity 0.1s linear",
              }}>Our Ingredients</p>

              {/* Cards */}
              {INGREDIENTS.map((ing, i) => {
                const { opacity, tx, ty } = cardVis[i];
                return (
                  <div key={i} style={{
                    position: "absolute", inset: 0,
                    background: "transparent",
                    opacity, zIndex: i,
                    willChange: "opacity",
                    pointerEvents: "none",
                  }}>
                    <div style={{
                      position: "absolute", top: "50%", left: 0, right: 0,
                      padding: "0 clamp(28px,8vw,80px)",
                      transform: `translateY(calc(-50% + ${ty}px)) translateX(${tx}px)`,
                      willChange: "transform", textAlign: "center",
                    }}>
                      {/* Amber rule */}
                      <div style={{ width: 40, height: 1, background: "rgba(2,70,40,0.6)", margin: "0 auto 28px" }} />

                      {/* Counter */}
                      <p style={{
                        margin: "0 0 14px", fontFamily: "var(--font-body)", fontSize: 8,
                        fontWeight: 200, letterSpacing: "0.5em", textTransform: "uppercase",
                        color: "rgba(255,255,255,0.4)",
                      }}>{String(i + 1).padStart(2, "0")} — {String(N_C).padStart(2, "0")}</p>

                      {/* Name */}
                      <h2 style={{
                        margin: "0 0 22px", fontFamily: "var(--font-heading)",
                        fontSize: "clamp(44px, 11vw, 88px)", fontWeight: 300,
                        color: "#FBF3D4", letterSpacing: "0.01em", lineHeight: 1,
                      }}>{ing.name}</h2>

                      {/* Benefit */}
                      <p style={{
                        margin: 0, fontFamily: "var(--font-body)", fontSize: 9,
                        fontWeight: 200, letterSpacing: "0.4em", textTransform: "uppercase",
                        color: "rgba(255,255,255,0.7)", lineHeight: 1.9,
                      }}>{ing.desc}</p>
                    </div>
                  </div>
                );
              })}

              {/* Progress indicator */}
              <div style={{
                position: "absolute", bottom: 28, left: "50%",
                transform: "translateX(-50%)", display: "flex", gap: 6,
                alignItems: "center", zIndex: 20, pointerEvents: "none",
              }}>
                {INGREDIENTS.map((_, j) => (
                  <div key={j} style={{
                    width: activeCard === j ? 16 : 4, height: 1,
                    background: activeCard === j ? "#ffffff" : "rgba(255,255,255,0.25)",
                    transition: "width 0.4s cubic-bezier(.22,1,.36,1), background 0.4s",
                  }} />
                ))}
              </div>
            </div>
          </div>

          {/* ══ SECTION 5 — CLOSING CTA ══ */}
          <section style={{
            minHeight: "100dvh", display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            padding: "80px 28px", textAlign: "center", position: "relative",
            overflow: "hidden",
          }}>
            {/* Background video */}
            <video autoPlay muted playsInline loop style={{
              position: "absolute", inset: 0, width: "100%", height: "100%",
              objectFit: "cover", zIndex: 0,
            }}>
              <source src="/bread-making-01.mp4" type="video/mp4" />
            </video>
            {/* Dark overlay */}
            <div style={{ position: "absolute", inset: 0, background: "rgba(6,4,2,0.70)", zIndex: 1, pointerEvents: "none" }} />
            <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 2 }} />

            <p style={{
              position: "relative", zIndex: 3,
              margin: 0, fontFamily: "var(--font-heading)",
              fontSize: "clamp(52px, 16vw, 96px)", fontWeight: 300,
              color: "#FBF3D4", letterSpacing: "0.06em", lineHeight: 1,
            }}>Cadieux</p>

            <p style={{
              position: "relative", zIndex: 3,
              margin: "20px 0 0", fontFamily: "var(--font-body)", fontSize: 9,
              fontWeight: 200, letterSpacing: "0.45em", textTransform: "uppercase",
              color: "#4369B2",
            }}>Same Bread. Better Built.</p>

            <button style={{
              position: "relative", zIndex: 3,
              display: "block", width: "100%", maxWidth: 320, marginTop: 28,
              fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
              letterSpacing: "0.4em", textTransform: "uppercase",
              color: "#FBF3D4", background: "#024628",
              border: "none", padding: 18, cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
            onClick={() => window.dispatchEvent(new Event("openShop"))}
            >Shop Now</button>
          </section>

        </div>
      </div>
    </>
  );
}
