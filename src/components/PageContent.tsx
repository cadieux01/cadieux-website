"use client";

import { useRef, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import QASection from "./QASection";

/* ── Helpers ── */
const sr    = (s: number) => { const x = Math.sin(s) * 43758.5453; return x - Math.floor(x); };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* Lazy-play a video when any pixel enters the viewport, and pause it the
   moment it's fully off-screen so a 5-video page doesn't decode all of them
   at once. Mobile Safari/Chrome can also reject too-early play()s silently —
   we retry on canplay/loadeddata to fix the "blank background" bug.

   Performance notes:
   • We do NOT kick play() unconditionally on mount — that previously caused
     5 simultaneous H.264 decoders to spin up on home and starved input/scroll
     responsiveness for the first 1-2s. The IntersectionObserver fires its
     initial callback right away, so the in-view video gets its play() with
     no perceptible delay; the others stay paused until scrolled to.
   • A second IO with a 600px rootMargin warms up `preload="none"` videos
     just before they enter view — so the user still sees a frame as they
     scroll past, without paying for metadata fetches on initial paint. */
const playOnEnter = (el: HTMLVideoElement | null) => {
  if (!el) return;
  // Defensive — React sets these from attributes, but re-asserting avoids
  // hydration races on iOS where muted reverts and play() then needs a gesture.
  el.muted = true;

  // shouldPlay is the source of truth for whether this video is currently
  // in the viewport. canplay/loadeddata fire after warm-up loads complete,
  // but we only want to actually play() if the video is still on-screen.
  let shouldPlay = false;
  const tryPlay = () => {
    if (!shouldPlay) return;
    void el.play().catch(() => {});
  };

  // Retry whenever the browser signals it has enough buffer.
  el.addEventListener("canplay", tryPlay);
  el.addEventListener("loadeddata", tryPlay);

  if (typeof IntersectionObserver === "undefined") {
    // Server-rendered or ancient browser — fall back to immediate play.
    shouldPlay = true;
    tryPlay();
    return;
  }

  // Warm preload before the video reaches the viewport so the first frame
  // is ready by the time the user scrolls to it.
  const warmIo = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting && el.preload !== "auto") {
        el.preload = "metadata";
        try { el.load(); } catch { /* noop */ }
        warmIo.disconnect();
      }
    }),
    { rootMargin: "600px 0px" }
  );
  warmIo.observe(el);

  // Play/pause based on actual visibility.
  const playIo = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting) {
        shouldPlay = true;
        tryPlay();
      } else {
        shouldPlay = false;
        if (!el.paused) el.pause();
      }
    }),
    { threshold: 0 }
  );
  playIo.observe(el);
};

/* ── SVG grain texture ── */
const GRAIN =
  "url(/grain.svg)";

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

// ── Founder section (homepage bottom, above footer) ────────────────
// Mirror of the app's home founder card. Foundation Green band,
// rounded portrait, short personal note, gold signature, soft link
// to /behind-cadieux. Kept as constants so non-engineers can edit
// copy without touching JSX.
const FOUNDER_HEADING = "Why I built Cadieux";
const FOUNDER_PARAGRAPHS = [
  "For a long time, eating well felt like a chore I had to survive. Same shake. Same eggs. Same bar. The discipline was working, but I\u2019d stopped enjoying any of it.",
  "All I wanted was good protein bread. I searched everywhere \u2014 found it online, but never here in Vizag. Not in a single store. Not even to my door.",
  "So I spent eighteen months making the bread I wished existed. This is it. I hope it makes your everyday a little better, the way it did mine.",
];
const FOUNDER_SIGNATURE = "\u2014 Sunny Raja, Founder";
const FOUNDER_LINK_LABEL = "Read the full story \u2192 Behind Cadieux";

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
    // Hero video is in viewport on first paint — play immediately.
    // IO below pauses it when scrolled past so it stops decoding offscreen.
    let inView = true;
    const tryPlay = () => { if (inView) v.play().catch(() => {}); };
    tryPlay();
    v.addEventListener("canplay", tryPlay, { once: true });
    v.addEventListener("loadeddata", tryPlay, { once: true });
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => entries.forEach((e) => {
          inView = e.isIntersecting;
          if (inView) tryPlay();
          else if (!v.paused) v.pause();
        }),
        { threshold: 0 }
      );
      io.observe(v);
    }
    return () => {
      v.removeEventListener("canplay", tryPlay);
      v.removeEventListener("loadeddata", tryPlay);
      if (io) io.disconnect();
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
              src="/grains.jpg"
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
                poster="/bread-intro.poster.jpg"
                style={{
                  position: "absolute", inset: 0,
                  width: "100%", height: "100%",
                  objectFit: "cover",
                  zIndex: 1,
                  backgroundColor: "#060402",
                }}
              >
                <source src="/bread-intro.av1.mp4" type='video/mp4; codecs="av01.0.05M.08"' />
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
              {/* Background video — lazy play on enter (preload="none" so it
                  doesn't compete with the hero video for bandwidth/decode on
                  first paint; playOnEnter warms it 600px before viewport) */}
              <video
                ref={playOnEnter} muted playsInline loop preload="none"
                poster="/product-video-05.poster.jpg"
                style={{
                  position: "absolute", inset: 0,
                  width: "100%", height: "100%",
                  objectFit: "cover", zIndex: 0,
                  backgroundColor: "#1D1D1F",
                }}
              >
                <source src="/product-video-05.av1.mp4" type='video/mp4; codecs="av01.0.05M.08"' />
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
                  {/*
                    Connector line — split into N_C-1 segments, each living in
                    the gap *between* two consecutive ingredient rows. The line
                    never passes through any text. Reveals are scoped to the
                    first 82% of cardsP so the last ingredient is fully active
                    before Phase 4 takes over.
                  */}
                  {Array.from({ length: N_C - 1 }, (_, i) => {
                    const stepP = clamp(cardsP / 0.82, 0, 1);
                    // Segments span between consecutive row CENTERS, which sit
                    // at (i + 0.5)/N — same coordinates the rows themselves
                    // are absolutely positioned at below.
                    const startPct = ((i + 0.5) / N_C) * 100;
                    const endPct = ((i + 1.5) / N_C) * 100;
                    const reachStart = (i + 0.5) / N_C;
                    const reachEnd = (i + 1.5) / N_C;
                    const segP = clamp((stepP - reachStart) / (reachEnd - reachStart), 0, 1);
                    return (
                      <div key={`seg-${i}`} style={{
                        position: "absolute", left: "50%", marginLeft: -0.5,
                        top: `calc(${startPct}% + 44px)`,
                        bottom: `calc(${100 - endPct}% + 44px)`,
                        width: 1, pointerEvents: "none",
                      }}>
                        {/* Dim backbone */}
                        <div style={{
                          position: "absolute", inset: 0,
                          background: "rgba(251,243,212,0.12)",
                        }} />
                        {/* Gold fill — scales within this segment */}
                        <div style={{
                          position: "absolute", inset: 0,
                          background: "#c9a96e",
                          boxShadow: "0 0 8px rgba(201,169,110,0.45)",
                          transformOrigin: "top",
                          transform: `scaleY(${segP})`,
                          willChange: "transform",
                        }} />
                      </div>
                    );
                  })}

                  {/* 6 ingredient rows — absolutely positioned with their
                      CENTERS at (i + 0.5)/N_C so they line up exactly with the
                      gaps between line segments. */}
                  <div style={{
                    position: "relative", height: "100%",
                  }}>
                    {INGREDIENTS.map((ing, i) => {
                      // Reveals are scoped to the first 82% of cardsP so
                      // Barley Malt is fully active before Phase 4 takes over.
                      const stepP = clamp(cardsP / 0.82, 0, 1);
                      const reachAt = (i + 0.5) / N_C;
                      const reached = stepP >= reachAt;
                      const reveal = clamp((stepP - (i / N_C)) * N_C * 1.2, 0, 1);
                      return (
                        <div key={i} style={{
                          position: "absolute",
                          top: `${reachAt * 100}%`,
                          left: 0, right: 0,
                          textAlign: "center",
                          opacity: 0.22 + reveal * 0.78,
                          transform: `translate(0, calc(-50% + ${(1 - reveal) * 6}px))`,
                          transition: "opacity 0.25s ease, transform 0.25s ease",
                        }}>
                          <p style={{
                            margin: 0,
                            fontFamily: "var(--font-heading)",
                            fontSize: "clamp(20px, 5vw, 30px)", fontWeight: 300,
                            color: reached ? "#FFF8E0" : "rgba(251,243,212,0.55)",
                            letterSpacing: "0.01em", lineHeight: 1.15,
                            textShadow: reached
                              ? "0 0 8px rgba(255,222,160,0.95), 0 0 22px rgba(201,169,110,0.9), 0 0 48px rgba(201,169,110,0.55), 0 0 90px rgba(201,169,110,0.3)"
                              : "none",
                            transition: "color 0.5s ease, text-shadow 0.5s ease",
                          }}>{ing.name}</p>
                          <p style={{
                            margin: "10px 0 0",
                            fontFamily: "var(--font-body)",
                            fontSize: 11, fontWeight: 300,
                            letterSpacing: "0.18em", textTransform: "uppercase",
                            color: reached ? "#FFF8E0" : "rgba(251,243,212,0.32)",
                            lineHeight: 1.6,
                            textShadow: reached
                              ? "0 0 8px rgba(255,222,160,0.85), 0 0 18px rgba(201,169,110,0.7), 0 0 36px rgba(201,169,110,0.4)"
                              : "none",
                            transition: "color 0.5s ease, text-shadow 0.5s ease",
                          }}>{ing.desc}</p>
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
              {/* Background video — lazy play on enter (preload="none" so it
                  doesn't compete with the hero video for bandwidth/decode on
                  first paint; playOnEnter warms it 600px before viewport) */}
              <video
                ref={playOnEnter} muted playsInline loop preload="none"
                poster="/bread-eating-01.poster.jpg"
                style={{
                  position: "absolute", inset: 0,
                  width: "100%", height: "100%",
                  objectFit: "cover", zIndex: 0,
                  backgroundColor: "#1D1D1F",
                }}
              >
                <source src="/bread-eating-01.av1.mp4" type='video/mp4; codecs="av01.0.05M.08"' />
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

                {/* Timeline rail — line is centered & extends to the very
                    top of the sticky so it visually bridges Phase 3's line
                    at the boundary. */}
                <div style={{
                  position: "relative", flex: 1, width: "100%",
                  maxWidth: 520, marginTop: "3.5vh",
                }}>
                  {/* Inter-row segments — one in the gap between each pair of
                      consecutive benefit rows. Line never passes through text.
                      No bridge to Phase 3: the heading "Protein isn't just for
                      athletes" stands as Phase 4's intro and must not be
                      crossed by any line. */}
                  {Array.from({ length: N_P - 1 }, (_, i) => {
                    const stepP = clamp(proteinP / 0.82, 0, 1);
                    // Segments span between consecutive row CENTERS, which
                    // sit at (i + 0.5)/N_P — same coordinates the rows
                    // themselves are absolutely positioned at below.
                    const startPct = ((i + 0.5) / N_P) * 100;
                    const endPct = ((i + 1.5) / N_P) * 100;
                    const reachStart = (i + 0.5) / N_P;
                    const reachEnd = (i + 1.5) / N_P;
                    const segP = clamp((stepP - reachStart) / (reachEnd - reachStart), 0, 1);
                    return (
                      <div key={`pseg-${i}`} style={{
                        position: "absolute", left: "50%", marginLeft: -0.5,
                        top: `calc(${startPct}% + 44px)`,
                        bottom: `calc(${100 - endPct}% + 44px)`,
                        width: 1, pointerEvents: "none",
                      }}>
                        <div style={{
                          position: "absolute", inset: 0,
                          background: "rgba(251,243,212,0.12)",
                        }} />
                        <div style={{
                          position: "absolute", inset: 0,
                          background: "#c9a96e",
                          boxShadow: "0 0 8px rgba(201,169,110,0.45)",
                          transformOrigin: "top",
                          transform: `scaleY(${segP})`,
                          willChange: "transform",
                        }} />
                      </div>
                    );
                  })}

                  {/* Benefit rows — absolutely positioned with their CENTERS
                      at (i + 0.5)/N_P so they line up exactly with the gaps
                      between line segments. */}
                  <div style={{
                    position: "relative", height: "100%",
                  }}>
                    {PROTEIN_BENEFITS.map((b, i) => {
                      const stepP = clamp(proteinP / 0.82, 0, 1);
                      const reachAt = (i + 0.5) / N_P;
                      const reached = stepP >= reachAt;
                      const reveal = clamp((stepP - (i / N_P)) * N_P * 1.2, 0, 1);
                      return (
                        <div key={b.n} style={{
                          position: "absolute",
                          top: `${reachAt * 100}%`,
                          left: 0, right: 0,
                          textAlign: "center",
                          opacity: 0.22 + reveal * 0.78,
                          transform: `translate(0, calc(-50% + ${(1 - reveal) * 6}px))`,
                          transition: "opacity 0.25s ease, transform 0.25s ease",
                        }}>
                          <p style={{
                            margin: 0,
                            fontFamily: "var(--font-heading)",
                            fontSize: "clamp(20px, 5vw, 30px)", fontWeight: 300,
                            color: reached ? "#FFF8E0" : "rgba(251,243,212,0.55)",
                            letterSpacing: "0.01em", lineHeight: 1.15,
                            textShadow: reached
                              ? "0 0 8px rgba(255,222,160,0.95), 0 0 22px rgba(201,169,110,0.9), 0 0 48px rgba(201,169,110,0.55), 0 0 90px rgba(201,169,110,0.3)"
                              : "none",
                            transition: "color 0.5s ease, text-shadow 0.5s ease",
                          }}>{b.title}</p>
                          <p style={{
                            margin: "10px 0 0",
                            fontFamily: "var(--font-body)",
                            fontSize: 11, fontWeight: 300,
                            letterSpacing: "0.05em",
                            color: reached ? "#FFF8E0" : "rgba(251,243,212,0.4)",
                            lineHeight: 1.6,
                            textShadow: reached
                              ? "0 0 8px rgba(255,222,160,0.85), 0 0 18px rgba(201,169,110,0.7), 0 0 36px rgba(201,169,110,0.4)"
                              : "none",
                            transition: "color 0.5s ease, text-shadow 0.5s ease",
                          }}>{b.desc}</p>
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
            {/* Background video — preload="none" because this is the deepest
                section with the largest video (15.6 MB); we don't want it
                fetching metadata on first paint. */}
            <video ref={playOnEnter} muted playsInline loop preload="none"
              poster="/bread-making-01.poster.jpg"
              style={{
                position: "absolute", inset: 0, width: "100%", height: "100%",
                objectFit: "cover", zIndex: 0, backgroundColor: "#060402",
              }}>
              <source src="/bread-making-01.av1.mp4" type='video/mp4; codecs="av01.0.05M.08"' />
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
          </section>

          {/* ══ SECTION 5b — SHOWCASE VIDEO (Column Drift, 1:1) ══
              Silent, looping brand loop sitting just above the Founder
              band. Autoplay-safe (muted + playsInline). Capped width so
              it never dominates the viewport. */}
          <section style={{
            background: "#024628",
            padding: "72px clamp(24px,6vw,80px) 0",
            position: "relative",
            zIndex: 3,
            display: "flex",
            justifyContent: "center",
          }}>
            <div style={{
              width: "100%",
              maxWidth: 640,
              aspectRatio: "1 / 1",
              borderRadius: 10,
              overflow: "hidden",
              background: "rgba(0,0,0,0.2)",
            }}>
              <video
                src="/column-drift.mp4"
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                aria-label="Cadieux column drift showcase"
                style={{
                  width: "100%",
                  height: "100%",
                  display: "block",
                  objectFit: "cover",
                }}
              />
            </div>
          </section>

          {/* ══ SECTION 6 — FOUNDER (homepage only, just above the footer) ══
              Foundation Green band per brand bible. Portrait + short
              personal note + gold signature + soft link to the full
              /behind-cadieux page. Confidentiality: no premix/supplier
              references — the recipe is framed as developed in-house. */}
          <section style={{
            background: "#024628",
            padding: "96px clamp(24px,6vw,80px)",
            position: "relative",
            zIndex: 3,
            display: "flex",
            justifyContent: "center",
          }}>
            <div style={{
              width: "100%",
              maxWidth: 720,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
            }}>
              <div style={{
                width: "min(220px, 60vw)",
                aspectRatio: "4 / 5",
                borderRadius: 10,
                overflow: "hidden",
                position: "relative",
                background: "rgba(0,0,0,0.2)",
                marginBottom: 32,
              }}>
                <Image
                  src="/founder-home.jpg"
                  alt="Sunny Raja, founder of Cadieux"
                  fill
                  sizes="(max-width: 640px) 60vw, 220px"
                  style={{ objectFit: "cover" }}
                />
              </div>

              <h2 style={{
                margin: "0 0 24px",
                fontFamily: "var(--font-heading)",
                fontSize: "clamp(28px,5vw,40px)",
                fontWeight: 300,
                color: "#FBF3D4",
                letterSpacing: "0.02em",
                lineHeight: 1.15,
              }}>
                {FOUNDER_HEADING}
              </h2>

              {FOUNDER_PARAGRAPHS.map((p, i) => (
                <p key={i} style={{
                  margin: "0 0 16px",
                  fontFamily: "var(--font-heading)",
                  fontSize: "clamp(15px,1.8vw,18px)",
                  fontWeight: 300,
                  color: "rgba(251,243,212,0.92)",
                  letterSpacing: "0.01em",
                  lineHeight: 1.75,
                  maxWidth: 560,
                }}>
                  {p}
                </p>
              ))}

              <p style={{
                margin: "24px 0 0",
                fontFamily: "var(--font-body)",
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: "#c9a96e",
              }}>
                {FOUNDER_SIGNATURE}
              </p>

              <Link
                href="/behind-cadieux"
                style={{
                  marginTop: 32,
                  fontFamily: "var(--font-body)",
                  fontSize: 11,
                  fontWeight: 300,
                  letterSpacing: "0.25em",
                  textTransform: "uppercase",
                  color: "rgba(251,243,212,0.75)",
                  textDecoration: "none",
                  borderBottom: "1px solid rgba(201,169,110,0.4)",
                  paddingBottom: 3,
                }}
              >
                {FOUNDER_LINK_LABEL}
              </Link>
            </div>
          </section>

          {/* ══ Brand / Company / Manufacturing footer ══
              Extracted out of the closing CTA section so the Founder
              band can sit between the CTA and the footer. Walnut bg
              matches the closing CTA so the seam is invisible. */}
          <footer style={{
            background: "#060402",
            padding: "56px 28px 80px",
            display: "flex", justifyContent: "center",
            position: "relative",
            zIndex: 3,
          }}>
            <div style={{
              maxWidth: 520, width: "100%",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
              textAlign: "center",
            }}>
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

              {/* ── Legal links ──
                  Five required policy pages. Each routes to a server-rendered
                  page that embeds the cleaned Termly HTML. Kept compact and
                  centred so the footer height grows by only one row on mobile. */}
              <div
                style={{
                  marginTop: 18,
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "center",
                  gap: "0.4rem 1.1rem",
                }}
              >
                <span style={{
                  width: "100%",
                  fontSize: 9, letterSpacing: "0.35em", textTransform: "uppercase",
                  color: "rgba(200,144,58,0.65)",
                  marginBottom: 4,
                }}>Legal</span>
                {[
                  ["Privacy Policy", "/privacy-policy"],
                  ["Cookie Policy", "/cookies"],
                  ["Terms", "/terms"],
                  ["Returns", "/refunds"],
                  ["Shipping", "/shipping"],
                ].map(([label, href]) => (
                  <a
                    key={href}
                    href={href}
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: 10,
                      fontWeight: 300,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      color: "rgba(251,243,212,0.55)",
                      textDecoration: "none",
                    }}
                  >
                    {label}
                  </a>
                ))}
              </div>
            </div>
          </footer>

        </div>
      </div>
    </>
  );
}
