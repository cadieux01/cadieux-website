"use client";

import { useRef, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QASection from "./QASection";

/* ── Helpers ── */
const sr    = (s: number) => { const x = Math.sin(s) * 43758.5453; return x - Math.floor(x); };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* Lazy-play a video when any pixel enters the viewport, and pause it the
   moment it's fully off-screen so a 5-video page doesn't decode all of them
   at once. Mobile Safari/Chrome can also reject too-early play()s silently —
   we retry on canplay/loadeddata to fix the "blank background" bug. */
const playOnEnter = (el: HTMLVideoElement | null) => {
  if (!el) return;
  // Defensive — React sets these from attributes, but re-asserting avoids
  // hydration races on iOS where muted reverts and play() then needs a gesture.
  el.muted = true;

  const tryPlay = () => { void el.play().catch(() => {}); };

  // Retry whenever the browser signals it has enough buffer.
  el.addEventListener("canplay", tryPlay);
  el.addEventListener("loadeddata", tryPlay);

  // Kick once now in case the element is already visible + ready.
  tryPlay();

  if (typeof IntersectionObserver === "undefined") return;
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting) tryPlay();
      else if (!el.paused) el.pause();
    }),
    { threshold: 0 }
  );
  io.observe(el);
};

/* ── SVG grain texture ── */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/* ── Content ── */
const INGREDIENTS = [
  { name: "Whey Protein",          desc: "Builds lean muscle and speeds up recovery" },
  { name: "Rye Sourdough Ferment", desc: "Ancient fermentation for better digestion" },
  { name: "Linseeds",              desc: "Omega-3 powerhouse for heart and brain" },
  { name: "Sunflower Seeds",       desc: "Rich in vitamin E and healthy fats" },
  { name: "Sesame Seeds",          desc: "Tiny seeds, massive mineral content" },
  { name: "Barley Malt",           desc: "Natural sweetness with a low glycemic touch" },
];

const CARD_BG = ["#1D1D1F", "#1F1F21", "#1B1B1D", "#212123"];

const PROTEIN_BENEFITS = [
  { n: "01", title: "Everyday Strength",  desc: "Holds your muscles together as you age." },
  { n: "02", title: "Keeps You Full",     desc: "Steadies hunger for hours, no cravings." },
  { n: "03", title: "Lasting Energy",     desc: "Keeps blood sugar steady, no crashes." },
  { n: "04", title: "Stronger Immunity",  desc: "Builds antibodies, enzymes, hormones." },
  { n: "05", title: "Sharper Mind",       desc: "Powers focus, mood and memory daily." },
];

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
  const router = useRouter();
  const grainRefs     = useRef<(HTMLImageElement | null)[]>([]);
  const cardsOuterRef = useRef<HTMLDivElement>(null);
  const videoRef      = useRef<HTMLVideoElement>(null);
  const proteinOuterRef = useRef<HTMLDivElement>(null);
  const [proteinP, setProteinP] = useState(0);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    // Attempt immediate playback; if metadata isn't ready, retry on canplay
    const tryPlay = () => v.play().catch(() => {});
    tryPlay();
    v.addEventListener("canplay", tryPlay, { once: true });
    v.addEventListener("loadeddata", tryPlay, { once: true });
    return () => {
      v.removeEventListener("canplay", tryPlay);
      v.removeEventListener("loadeddata", tryPlay);
    };
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

  /* ── Protein benefits — scroll-driven sticky progress (same pattern as ingredients) ── */
  useEffect(() => {
    let rafId: number;
    let last = -1;
    let cachedTop = 0, cachedH = 0, cachedWh = 0;
    const measure = () => {
      const el = proteinOuterRef.current;
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
      setProteinP(clamp((sy - cachedTop) / (cachedH - cachedWh), 0, 1));
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

  const N_P = PROTEIN_BENEFITS.length;

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
                preload="metadata"
                loop
                style={{
                  position: "absolute", inset: 0,
                  width: "100%", height: "100%",
                  objectFit: "cover",
                  zIndex: 1,
                  backgroundColor: "#060402",
                }}
              >
                <source src="/bread-intro.mp4" type="video/mp4" />
              </video>
              <div style={{
                position: "absolute", inset: 0, zIndex: 2,
                background: "radial-gradient(ellipse at center, transparent 40%, rgba(29,29,31,0.6) 100%)",
                pointerEvents: "none",
              }} />
              {/* Top-center company wordmark */}
              <p style={{
                position: "absolute", top: 28, left: 0, right: 0,
                margin: 0, zIndex: 4,
                textAlign: "center",
                fontFamily: "var(--font-heading)",
                fontSize: 18, fontWeight: 300,
                letterSpacing: "0.45em", textTransform: "uppercase",
                color: "#FBF3D4",
                pointerEvents: "none",
                textShadow: "0 1px 12px rgba(0,0,0,0.5)",
              }}>Core Element</p>
              {/* Bold statement — top left */}
              <div style={{
                position: "relative", zIndex: 3,
                paddingLeft: "clamp(28px, 8vw, 80px)",
                paddingRight: "clamp(28px, 8vw, 80px)",
                paddingTop: "clamp(80px, 18vh, 160px)",
              }}>
                <img
                  src="/logo-icon.png"
                  alt="Cadieux"
                  style={{
                    display: "block",
                    width: "clamp(42px, 6vw, 62px)",
                    height: "auto",
                    marginBottom: 10,
                    pointerEvents: "none",
                    filter: "invert(1) sepia(1) saturate(0.3) brightness(1.1)",
                    mixBlendMode: "screen",
                  }}
                />
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
              onClick={() => router.push("/shop")}
              style={{
                position: "absolute", bottom: 48, left: "clamp(28px, 8vw, 80px)", zIndex: 4,
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

          {/* ══ SECTION 4 — INGREDIENT CARDS (scroll-driven sticky) ══ */}
          {/* Slow overlap with Phase 2 — same pattern as Phase 3→4 (pull up 100vh, no coating) */}
          <div ref={cardsOuterRef} style={{ position: "relative", height: `${N_C * 100}vh`, marginTop: "-100vh", zIndex: 3 }}>
            <div style={{
              position: "sticky", top: 0, height: "100dvh", overflow: "hidden",
              background: "#1D1D1F",
            }}>
              {/* Background video — lazy play on enter */}
              <video
                ref={playOnEnter} autoPlay muted playsInline loop preload="metadata"
                style={{
                  position: "absolute", inset: 0,
                  width: "100%", height: "100%",
                  objectFit: "cover", zIndex: 0,
                  backgroundColor: "#1D1D1F",
                }}
              >
                <source src="/product-video-05.mp4" type="video/mp4" />
              </video>
              {/* Dark overlay */}
              <div style={{ position: "absolute", inset: 0, background: "rgba(6,4,2,0.62)", zIndex: 0, pointerEvents: "none" }} />
              {/* Shared grain overlay */}
              <div style={{ position: "absolute", inset: 0, zIndex: 10, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none" }} />

              {/* Timeline content — heading + connector line + 6 ingredients,
                  all visible at once, line draws from heading through each
                  ingredient progressively as the section is scrolled. */}
              <div style={{
                position: "absolute", inset: 0, zIndex: 20,
                display: "flex", flexDirection: "column", alignItems: "center",
                padding: "8vh 24px 5vh",
                pointerEvents: "none",
              }}>
                {/* Heading */}
                <h2 style={{
                  margin: 0, textAlign: "center",
                  fontFamily: "var(--font-heading)",
                  fontSize: "clamp(28px,6vw,44px)", fontWeight: 300,
                  letterSpacing: "0.04em", color: "#FBF3D4", lineHeight: 1.1,
                }}>Ingredients That Matter</h2>

                {/* Timeline rail — line + ingredients column, fills remaining height */}
                <div style={{
                  position: "relative", flex: 1, width: "100%",
                  maxWidth: 520, marginTop: "3.5vh",
                }}>
                  {/* Dim full-length backbone */}
                  <div style={{
                    position: "absolute", left: 28, top: 0, bottom: 0,
                    width: 1, background: "rgba(251,243,212,0.12)",
                  }} />
                  {/*
                    The line + every ingredient must be fully active BEFORE
                    Phase 4 takes over (Phase 4 starts overlapping at the very
                    end of this section due to its -100vh marginTop). To give
                    Barley Malt — the last ingredient — proper dwell time on
                    screen before being covered, we map all reveals into the
                    first REVEAL_END portion of cardsP. Everything is settled
                    by ~82% of the scroll, leaving ~18% (~100vh) of "all-
                    revealed" view before the Phase 4 screen begins.
                  */}
                  {/* Gold revealed line — full-height parent, child scales
                      via transform (compositor-only, no layout). */}
                  <div style={{
                    position: "absolute", left: 28, top: 0,
                    height: "100%", width: 1, pointerEvents: "none",
                  }}>
                    <div style={{
                      position: "absolute", inset: 0,
                      background: "#c9a96e",
                      boxShadow: "0 0 8px rgba(201,169,110,0.45)",
                      transformOrigin: "top",
                      transform: `scaleY(${clamp(cardsP / 0.82, 0, 1)})`,
                      willChange: "transform",
                    }} />
                  </div>

                  {/* 6 ingredient rows, evenly distributed top-to-bottom */}
                  <div style={{
                    position: "relative", height: "100%",
                    display: "flex", flexDirection: "column",
                    justifyContent: "space-between",
                  }}>
                    {INGREDIENTS.map((ing, i) => {
                      // Reveals are scoped to the first 82% of cardsP so
                      // Barley Malt is fully active before Phase 4 takes over.
                      const stepP = clamp(cardsP / 0.82, 0, 1);
                      const dotAt = (i + 0.5) / N_C;
                      const reached = stepP >= dotAt;
                      // Soft text reveal that begins shortly before the line
                      // arrives so the row never appears empty.
                      const reveal = clamp((stepP - (i / N_C)) * N_C * 1.2, 0, 1);
                      return (
                        <div key={i} style={{
                          display: "flex", alignItems: "flex-start", gap: 18,
                          paddingLeft: 0,
                        }}>
                          {/* Dot */}
                          <div style={{
                            position: "relative",
                            flex: "0 0 auto",
                            width: 13, height: 13, marginTop: 7, marginLeft: 22,
                            borderRadius: 99,
                            background: reached ? "#c9a96e" : "rgba(251,243,212,0.18)",
                            boxShadow: reached ? "0 0 10px rgba(201,169,110,0.55)" : "none",
                            border: "2px solid #1D1D1F",
                            transition: "background 0.25s ease, box-shadow 0.25s ease",
                          }} />
                          {/* Name + desc */}
                          <div style={{
                            flex: 1, minWidth: 0,
                            opacity: 0.22 + reveal * 0.78,
                            transform: `translateX(${(1 - reveal) * 8}px)`,
                            transition: "opacity 0.2s linear, transform 0.25s ease",
                          }}>
                            <p style={{
                              margin: 0,
                              fontFamily: "var(--font-heading)",
                              fontSize: "clamp(20px, 5vw, 30px)", fontWeight: 300,
                              color: "#FBF3D4", letterSpacing: "0.01em", lineHeight: 1.15,
                            }}>{ing.name}</p>
                            <p style={{
                              margin: "6px 0 0",
                              fontFamily: "var(--font-body)",
                              fontSize: 11, fontWeight: 300,
                              letterSpacing: "0.18em", textTransform: "uppercase",
                              color: "rgba(251,243,212,0.55)", lineHeight: 1.6,
                            }}>{ing.desc}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>


          {/* ══ SECTION 4.5 — PHASE 3.5: WHY PROTEIN (sticky scroll-driven) ══ */}
          {/* Pull up 100vh so Phase 4's sticky begins exactly as Phase 3's cards finish fading — no dead zone */}
          <div ref={proteinOuterRef} style={{ position: "relative", height: `${N_P * 100}vh`, marginTop: "-100vh", zIndex: 3 }}>
            <div style={{
              position: "sticky", top: 0, height: "100dvh", overflow: "hidden",
              background: "#1D1D1F",
            }}>
              {/* Background video — lazy play on enter */}
              <video
                ref={playOnEnter} autoPlay muted playsInline loop preload="metadata"
                style={{
                  position: "absolute", inset: 0,
                  width: "100%", height: "100%",
                  objectFit: "cover", zIndex: 0,
                  backgroundColor: "#1D1D1F",
                }}
              >
                <source src="/bread-eating-01.mp4" type="video/mp4" />
              </video>
              {/* Dark overlay — matched to Phase 3 */}
              <div style={{ position: "absolute", inset: 0, background: "rgba(6,4,2,0.62)", zIndex: 0, pointerEvents: "none" }} />
              {/* Bottom blend to closing section */}
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                height: "25vh", zIndex: 12, pointerEvents: "none",
                background: "linear-gradient(to bottom, transparent, #1D1D1F)",
              }} />
              {/* Shared grain overlay */}
              <div style={{ position: "absolute", inset: 0, zIndex: 10, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none" }} />

              {/* Timeline content — heading + connector line + 5 benefits,
                  same pattern as the ingredients section. */}
              <div style={{
                position: "absolute", inset: 0, zIndex: 20,
                display: "flex", flexDirection: "column", alignItems: "center",
                padding: "8vh 24px 5vh",
                pointerEvents: "none",
              }}>
                {/* Heading */}
                <h2 style={{
                  margin: 0, textAlign: "center",
                  fontFamily: "var(--font-heading)",
                  fontSize: "clamp(28px,6vw,44px)", fontWeight: 300,
                  letterSpacing: "0.04em", color: "#FBF3D4", lineHeight: 1.1,
                }}>Protein isn&apos;t just for athletes</h2>

                {/* Timeline rail */}
                <div style={{
                  position: "relative", flex: 1, width: "100%",
                  maxWidth: 520, marginTop: "3.5vh",
                }}>
                  {/* Dim full-length backbone */}
                  <div style={{
                    position: "absolute", left: 28, top: 0, bottom: 0,
                    width: 1, background: "rgba(251,243,212,0.12)",
                  }} />
                  {/* Gold revealed line — full-height parent, child scales
                      via transform (compositor-only, no layout). */}
                  <div style={{
                    position: "absolute", left: 28, top: 0,
                    height: "100%", width: 1, pointerEvents: "none",
                  }}>
                    <div style={{
                      position: "absolute", inset: 0,
                      background: "#c9a96e",
                      boxShadow: "0 0 8px rgba(201,169,110,0.45)",
                      transformOrigin: "top",
                      transform: `scaleY(${clamp(proteinP / 0.82, 0, 1)})`,
                      willChange: "transform",
                    }} />
                  </div>

                  {/* Benefit rows, evenly distributed top-to-bottom */}
                  <div style={{
                    position: "relative", height: "100%",
                    display: "flex", flexDirection: "column",
                    justifyContent: "space-between",
                  }}>
                    {PROTEIN_BENEFITS.map((b, i) => {
                      const stepP = clamp(proteinP / 0.82, 0, 1);
                      const dotAt = (i + 0.5) / N_P;
                      const reached = stepP >= dotAt;
                      const reveal = clamp((stepP - (i / N_P)) * N_P * 1.2, 0, 1);
                      return (
                        <div key={b.n} style={{
                          display: "flex", alignItems: "flex-start", gap: 18,
                        }}>
                          {/* Dot */}
                          <div style={{
                            position: "relative",
                            flex: "0 0 auto",
                            width: 13, height: 13, marginTop: 7, marginLeft: 22,
                            borderRadius: 99,
                            background: reached ? "#c9a96e" : "rgba(251,243,212,0.18)",
                            boxShadow: reached ? "0 0 10px rgba(201,169,110,0.55)" : "none",
                            border: "2px solid #1D1D1F",
                            transition: "background 0.25s ease, box-shadow 0.25s ease",
                          }} />
                          {/* Title + body */}
                          <div style={{
                            flex: 1, minWidth: 0,
                            opacity: 0.22 + reveal * 0.78,
                            transform: `translateX(${(1 - reveal) * 8}px)`,
                            transition: "opacity 0.2s linear, transform 0.25s ease",
                          }}>
                            <p style={{
                              margin: 0,
                              fontFamily: "var(--font-heading)",
                              fontSize: "clamp(20px, 5vw, 30px)", fontWeight: 300,
                              color: "#FBF3D4", letterSpacing: "0.01em", lineHeight: 1.15,
                            }}>{b.title}</p>
                            <p style={{
                              margin: "6px 0 0",
                              fontFamily: "var(--font-body)",
                              fontSize: 11, fontWeight: 300,
                              letterSpacing: "0.05em",
                              color: "rgba(251,243,212,0.6)", lineHeight: 1.6,
                            }}>{b.desc}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ══ SECTION 5 — CLOSING CTA ══ */}
          {/* No overlap on this boundary — Phase 4's bottom benefits (Sharper
              Mind) need full dwell time before the CTA scrolls in. */}
          <section style={{
            minHeight: "100dvh", display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            padding: "80px 28px", textAlign: "center", position: "relative",
            overflow: "hidden",
            zIndex: 3,
            backgroundColor: "#060402",
          }}>
            {/* Background video */}
            <video ref={playOnEnter} autoPlay muted playsInline loop preload="metadata" style={{
              position: "absolute", inset: 0, width: "100%", height: "100%",
              objectFit: "cover", zIndex: 0, backgroundColor: "#060402",
            }}>
              <source src="/bread-making-01.mp4" type="video/mp4" />
            </video>
            {/* Dark overlay */}
            <div style={{ position: "absolute", inset: 0, background: "rgba(6,4,2,0.70)", zIndex: 1, pointerEvents: "none" }} />
            <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 2 }} />

            <img
              src="/logo-icon.png"
              alt="Cadieux"
              style={{
                position: "relative", zIndex: 3,
                display: "block",
                width: "clamp(72px, 18vw, 120px)",
                height: "auto",
                marginBottom: 20,
                pointerEvents: "none",
                filter: "invert(1) sepia(0.4) saturate(0.8) brightness(0.95)",
              }}
            />
            <p style={{
              position: "relative", zIndex: 3,
              margin: 0, fontFamily: "var(--font-heading)",
              fontSize: "clamp(40px, 13vw, 84px)", fontWeight: 300,
              color: "#FBF3D4", letterSpacing: "0.05em", lineHeight: 1.05,
            }}>Core Element</p>

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
            onClick={() => router.push("/shop")}
            >Shop Now</button>

            {/* ── Brand / Company / Manufacturing footer ── */}
            <div style={{
              position: "relative", zIndex: 3,
              marginTop: 64, paddingTop: 28,
              borderTop: "1px solid rgba(251,243,212,0.12)",
              maxWidth: 520, width: "100%",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
              textAlign: "center",
            }}>
              <p style={{
                margin: 0,
                fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 300,
                letterSpacing: "0.45em", textTransform: "uppercase",
                color: "rgba(251,243,212,0.5)",
              }}>Cadieux Pvt. Ltd.</p>

              <p style={{
                margin: 0,
                fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200,
                letterSpacing: "0.04em", lineHeight: 1.7,
                color: "rgba(251,243,212,0.6)",
                maxWidth: 380,
              }}>
                <span style={{ display: "block", fontSize: 9, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(200,144,58,0.65)", marginBottom: 6 }}>Manufactured at</span>
                D.no. 13/18, Plot 78, P.M Palem,<br />
                Revenue Ward 4, Visakhapatnam — 530041
              </p>

              <a
                href="https://instagram.com/cadieuxindia"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 300,
                  letterSpacing: "0.3em", textTransform: "uppercase",
                  color: "#C8903A", textDecoration: "none",
                  borderBottom: "1px solid rgba(200,144,58,0.4)",
                  paddingBottom: 2,
                }}
              >@cadieuxindia</a>
            </div>
          </section>

        </div>
      </div>
    </>
  );
}
