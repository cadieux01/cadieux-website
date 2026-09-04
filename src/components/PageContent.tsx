"use client";

import { useRef, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import QASection from "./QASection";
import { lazyPlayOnEnter } from "@/lib/lazyVideo";

/* ── SVG grain texture ── */
const GRAIN =
  "url(/grain.svg)";

/* ── Content ── */
const INGREDIENTS = [
  { name: "Whey Protein",          desc: "A complete protein source" },
  { name: "Rye Sourdough Ferment", desc: "Slow-fermented, traditional method" },
  { name: "Linseeds",              desc: "A source of omega-3 and fibre" },
  { name: "Sunflower Seeds",       desc: "A source of vitamin E" },
  { name: "Sesame Seeds",          desc: "A source of minerals" },
  { name: "Barley Malt",           desc: "Naturally malted for subtle sweetness" },
];

const PROTEIN_BENEFITS = [
  { n: "01", title: "Everyday Strength",  desc: "Protein for everyday movement." },
  { n: "02", title: "Keeps You Full",     desc: "Satisfying and substantial." },
  { n: "03", title: "Lasting Energy",     desc: "Steady fuel for your day." },
  { n: "04", title: "Stronger Immunity",  desc: "Everyday nourishment." },
  { n: "05", title: "Sharper Mind",       desc: "Made to keep up with your day." },
];

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
  "So I spent two years making the bread I wished existed. This is it. I hope it makes your everyday a little better, the way it did mine.",
];
const FOUNDER_SIGNATURE = "\u2014 Sunny Raja, Founder";
const FOUNDER_LINK_LABEL = "Read the full story \u2192 Behind Cadieux";

export default function PageContent({ introActive = false }: { introActive?: boolean }) {
  const router = useRouter();
  const cardsOuterRef = useRef<HTMLDivElement>(null);
  const videoRef      = useRef<HTMLVideoElement>(null);
  const proteinOuterRef = useRef<HTMLDivElement>(null);
  const [proteinRevealed, setProteinRevealed] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    // Bulletproof muted autoplay for the hero. It attempts play immediately on
    // mount regardless of any intro state, and never pauses. Safari only permits
    // autoplay when the element is reliably muted at the moment it evaluates it,
    // so we set BOTH muted and defaultMuted before every play() — the attribute
    // alone isn't always enough. A too-early play() (readyState still low before
    // the larger re-encoded file has buffered) is what Safari rejects and
    // surfaces as its native play button, so we only play once there's data
    // (canplay/loadeddata) and, on any rejection, re-assert muted and retry once.
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retried = false;

    const play = () => {
      v.muted = true;
      v.defaultMuted = true;
      const p = v.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          if (retried) return;
          retried = true;
          retryTimer = setTimeout(() => {
            v.muted = true;
            v.defaultMuted = true;
            void v.play().catch(() => {});
          }, 200);
        });
      }
    };

    // Ensure muted is asserted up-front too, before the browser evaluates
    // the autoPlay attribute on first paint.
    v.muted = true;
    v.defaultMuted = true;

    // Gate on readiness: play now if the element already has enough buffered
    // (readyState >= HAVE_FUTURE_DATA); otherwise these events fire play() the
    // instant it does. NOT { once: true } — an early canplay can precede a
    // truly-ready decoder on mobile, and a later signal then succeeds.
    v.addEventListener("canplay", play);
    v.addEventListener("loadeddata", play);
    v.addEventListener("canplaythrough", play);
    if (v.readyState >= 3) play();

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      v.removeEventListener("canplay", play);
      v.removeEventListener("loadeddata", play);
      v.removeEventListener("canplaythrough", play);
    };
  }, []);

  /* ── Ingredient cards — reveal on entry (no scroll-pin) ──
     The section is a single 100dvh panel. An IntersectionObserver flips
     `cardsRevealed` when the panel enters/leaves the viewport; the cards
     then fade/slide in on a per-item transition-delay stagger (see JSX).
     Toggling on exit re-arms a clean replay on re-entry — it never loops. */
  const [cardsRevealed, setCardsRevealed] = useState(false);

  useEffect(() => {
    const el = cardsOuterRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setCardsRevealed(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => setCardsRevealed(e.isIntersecting)),
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* ── Protein benefits — reveal on entry (same pattern as ingredients) ── */
  useEffect(() => {
    const el = proteinOuterRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setProteinRevealed(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => setProteinRevealed(e.isIntersecting)),
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const N_P = PROTEIN_BENEFITS.length;

  return (
    <>
      <div style={{ position: "relative", background: "#024628", overflowX: "clip" }}>

        <div style={{ position: "relative", zIndex: 1 }}>

          {/* ══ SECTION 1 — VIDEO ══
              NOTE: do NOT put `content-visibility: auto` on this wrapper.
              It contains the hero <video>; skipping its rendering
              off-screen leaves the video frozen on its first frame and it
              never resumes on re-entry. */}
          <div style={{
            position: "relative", height: "100dvh",
          }}>
            <section style={{
              position: "absolute", inset: 0, overflow: "hidden",
              display: "flex", flexDirection: "column", justifyContent: "flex-start",
              // The Shop Now button is the last item in this column (see below)
              // rather than absolutely positioned, so the headline and the
              // button reserve space against each other instead of colliding on
              // short viewports. paddingBottom keeps the button the same 48px
              // off the bottom edge it sat at when it was positioned. (The
              // floor on the space between the two is a marginBottom on the
              // text block, NOT rowGap here — a gap would also apply above the
              // text block and push the headline down 24px.)
              paddingBottom: 48,
              // FIX 1 (Task F v2 follow-up): removed maskImage that faded
              // the video to transparent at 88% — was revealing the
              // #024628 wrapper bg below, reading as a green gradient
              // rising up into the hero. Section now sits edge-to-edge
              // and hands off cleanly to the QA section that follows.
            }}>
              {/*
                Mobile-first source order (perf pass): phones ≤720px CSS px
                get the 480x854 variants (~370-430 KB) instead of the 720p
                desktop ones (~650-660 KB). AV1-first inside each viewport
                bucket keeps the existing ordering convention; H.264 fallback
                for Safari and older Chromium.
              */}
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                preload="auto"
                loop
                disablePictureInPicture
                disableRemotePlayback
                controlsList="nodownload nofullscreen noremoteplayback"
                poster="/bread-intro.poster.jpg"
                style={{
                  position: "absolute", inset: 0,
                  width: "100%", height: "100%",
                  objectFit: "cover",
                  zIndex: 1,
                  backgroundColor: "#024628",
                }}
              >
                <source src="/bread-intro.mobile.mp4" type="video/mp4" media="(max-width: 720px)" />
                <source src="/bread-intro.mobile.av1.mp4" type='video/mp4; codecs="av01.0.05M.08"' media="(max-width: 720px)" />
                <source src="/bread-intro.mp4" type="video/mp4" />
                <source src="/bread-intro.av1.mp4" type='video/mp4; codecs="av01.0.05M.08"' />
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
              {/* The headline's top offset, as its own flex item rather than
                  padding on the block below. Identical at normal heights, but a
                  flex item can shrink: on a short viewport this collapses first
                  so the headline and the button both stay whole instead of the
                  button being pushed out of the clipped section. */}
              <div style={{
                flex: "0 1 clamp(80px, 18vh, 160px)",
                minHeight: 0,
              }} />
              {/* Bold statement — top left */}
              <div style={{
                position: "relative", zIndex: 3,
                flexShrink: 0,
                paddingLeft: "clamp(28px, 8vw, 80px)",
                paddingRight: "clamp(28px, 8vw, 80px)",
                // Floor on the space to the Shop Now button below. It sits
                // under the headline, so it never moves the headline itself.
                marginBottom: 24,
              }}>
                <img
                  src="/logo-icon.webp"
                  alt="Cadieux"
                  style={{
                    display: "block",
                    width: "clamp(42px, 6vw, 62px)",
                    // Square logo — reserve the box via aspect-ratio so the
                    // heading below doesn't shift down when the image loads
                    // (this shift was previously hidden by the intro splash).
                    aspectRatio: "1",
                    height: "auto",
                    marginBottom: 10,
                    pointerEvents: "none",
                    filter: "invert(1) sepia(1) saturate(0.3) brightness(1.1)",
                    mixBlendMode: "screen",
                  }}
                />
                <p style={{
                  margin: "0 0 16px",
                  fontFamily: "var(--font-body)", fontSize: 14,
                  fontWeight: 500, letterSpacing: "0.45em", textTransform: "uppercase",
                  color: "#FBF3D4", pointerEvents: "none",
                }}>Cadieux</p>
                {/* Primary hero heading. Rendered as an <h1> (the page's only
                    one) so it's both the SEO title and a text-based LCP
                    candidate present in the first server paint. */}
                <h1 style={{
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
                </h1>
              </div>
              {/* Shop Now — last item in the hero column. marginTop:auto holds
                  it against the section's bottom padding, so it lands exactly
                  where it did when it was position:absolute bottom:48px, but on
                  a short viewport it is pushed by the headline instead of
                  overlapping it. */}
              <button
                onClick={() => router.push("/shop")}
                style={{
                  position: "relative", zIndex: 4,
                  marginTop: "auto",
                  marginLeft: "clamp(28px, 8vw, 80px)",
                  alignSelf: "flex-start",
                  flexShrink: 0,
                  fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
                  letterSpacing: "0.4em", textTransform: "uppercase",
                  color: "#FBF3D4", background: "#024628",
                  border: "none", padding: "10px 24px", cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}>Shop Now</button>
            </section>
          </div>

          {/* FIX 6: removed Phase 1→2 gradient bridge — was creating a visible
              green bleed at the bottom of the hero video. The masked video
              already fades to transparent at 88%, and the container's own
              #024628 background provides the clean edge without a gradient. */}

          {/* ══ Q&A SECTION ══ */}
          <QASection />

          {/* ══ SECTION 4 — INGREDIENT CARDS (single-viewport, auto-reveal on entry) ══ */}
          {/* Normal flow directly after the QA pin — no marginTop overlap, no
              scroll-pin. The panel fills one viewport and reveals its cards on
              entry via an IntersectionObserver (see cardsRevealed effect). */}
          <div ref={cardsOuterRef} style={{ position: "relative", height: "100dvh", zIndex: 3 }}>
            <div style={{
              position: "relative", height: "100%", overflow: "hidden",
              background: "#024628",
            }}>
              {/* Background video — deferred: preload="none" and no autoplay
                  attribute, so nothing is fetched until lazyPlayOnEnter sees it
                  approach the viewport. The poster covers the wait. Once it
                  starts it plays for the life of the page and never pauses. */}
              <video
                ref={lazyPlayOnEnter} muted playsInline loop preload="none"
                disablePictureInPicture disableRemotePlayback
                controlsList="nodownload nofullscreen noremoteplayback"
                poster="/product-video-05.poster.jpg"
                style={{
                  position: "absolute", inset: 0,
                  width: "100%", height: "100%",
                  objectFit: "cover", zIndex: 0,
                  backgroundColor: "#024628",
                }}
              >
                <source src="/product-video-05.mp4" type="video/mp4" />
                <source src="/product-video-05.av1.mp4" type='video/mp4; codecs="av01.0.05M.08"' />
              </video>
              {/* Dark overlay */}
              <div style={{ position: "absolute", inset: 0, background: "rgba(29,29,31,0.62)", zIndex: 0, pointerEvents: "none" }} />
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

                {/* Section subhead — reuses QASection's answer paragraph
                    style so it sits natively on this Foundation Green
                    background beneath the H2. */}
                <p style={{
                  margin: "18px auto 0",
                  fontFamily: "var(--font-body)",
                  fontSize: 16,
                  lineHeight: 1.95,
                  color: "rgba(251,243,212,0.85)",
                  maxWidth: 540,
                  textAlign: "center",
                  padding: "0 24px",
                }}>
                  A protein-rich bread with no artificial preservatives. Nothing hidden.
                </p>

                {/* Timeline rail — line + ingredients column, fills remaining height */}
                <div style={{
                  position: "relative", flex: 1, width: "100%",
                  maxWidth: 520, marginTop: "3.5vh",
                }}>
                  {/*
                    Connector line — split into N_C-1 segments, each living in
                    the gap *between* two consecutive ingredient rows. The line
                    never passes through any text. Each segment draws (scaleY
                    0→1) on entry, shortly after the row above it appears.
                  */}
                  {Array.from({ length: N_C - 1 }, (_, i) => {
                    // Segments span between consecutive row CENTERS, which sit
                    // at (i + 0.5)/N — same coordinates the rows themselves
                    // are absolutely positioned at below.
                    const startPct = ((i + 0.5) / N_C) * 100;
                    const endPct = ((i + 1.5) / N_C) * 100;
                    const segDelay = i * 170 + 120;
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
                        {/* Gold fill — draws in on entry */}
                        <div style={{
                          position: "absolute", inset: 0,
                          background: "#024628",
                          boxShadow: "0 0 8px rgba(201,169,110,0.45)",
                          transformOrigin: "top",
                          transform: cardsRevealed ? "scaleY(1)" : "scaleY(0)",
                          transition: `transform 0.42s ease ${segDelay}ms`,
                          willChange: "transform",
                        }} />
                      </div>
                    );
                  })}

                  {/* 6 ingredient rows — absolutely positioned with their
                      CENTERS at (i + 0.5)/N_C so they line up exactly with the
                      gaps between line segments. Each fades/slides in on entry
                      on a staggered transition-delay. */}
                  <div style={{
                    position: "relative", height: "100%",
                  }}>
                    {INGREDIENTS.map((ing, i) => {
                      const reachAt = (i + 0.5) / N_C;
                      const reached = cardsRevealed;
                      const delay = i * 170;
                      return (
                        <div key={i} style={{
                          position: "absolute",
                          top: `${reachAt * 100}%`,
                          left: 0, right: 0,
                          textAlign: "center",
                          opacity: cardsRevealed ? 1 : 0,
                          transform: cardsRevealed
                            ? "translate(0, -50%)"
                            : "translate(0, calc(-50% + 8px))",
                          transition: `opacity 0.52s ease ${delay}ms, transform 0.52s ease ${delay}ms`,
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
                            transition: `color 0.5s ease ${delay}ms, text-shadow 0.5s ease ${delay}ms`,
                          }}>{ing.name}</p>
                          <p style={{
                            margin: "10px 0 0",
                            fontFamily: "var(--font-body)",
                            fontSize: 14, fontWeight: 500,
                            letterSpacing: "0.18em", textTransform: "uppercase",
                            color: reached ? "#FFF8E0" : "rgba(251,243,212,0.32)",
                            lineHeight: 1.6,
                            textShadow: reached
                              ? "0 0 8px rgba(255,222,160,0.85), 0 0 18px rgba(201,169,110,0.7), 0 0 36px rgba(201,169,110,0.4)"
                              : "none",
                            transition: `color 0.5s ease ${delay}ms, text-shadow 0.5s ease ${delay}ms`,
                          }}>{ing.desc}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>


          {/* ══ SECTION 4.5 — WHY PROTEIN (single-viewport, auto-reveal on entry) ══ */}
          {/* Normal flow directly after the Ingredients panel — no marginTop
              overlap, no scroll-pin. Fills one viewport and reveals its 5
              benefits on entry via an IntersectionObserver (see proteinRevealed
              effect). */}
          <div ref={proteinOuterRef} style={{ position: "relative", height: "100dvh", zIndex: 3 }}>
            <div style={{
              position: "relative", height: "100%", overflow: "hidden",
              background: "#024628",
            }}>
              {/* Background video — deferred: preload="none" and no autoplay
                  attribute, so nothing is fetched until lazyPlayOnEnter sees it
                  approach the viewport. The poster covers the wait. Once it
                  starts it plays for the life of the page and never pauses. */}
              <video
                ref={lazyPlayOnEnter} muted playsInline loop preload="none"
                disablePictureInPicture disableRemotePlayback
                controlsList="nodownload nofullscreen noremoteplayback"
                poster="/bread-eating-01.poster.jpg"
                style={{
                  position: "absolute", inset: 0,
                  width: "100%", height: "100%",
                  objectFit: "cover", zIndex: 0,
                  backgroundColor: "#024628",
                }}
              >
                <source src="/bread-eating-01.mp4" type="video/mp4" />
                <source src="/bread-eating-01.av1.mp4" type='video/mp4; codecs="av01.0.05M.08"' />
              </video>
              {/* Dark overlay — matched to Phase 3 */}
              <div style={{ position: "absolute", inset: 0, background: "rgba(29,29,31,0.62)", zIndex: 0, pointerEvents: "none" }} />
              {/* Bottom blend to closing section */}
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                height: "25vh", zIndex: 12, pointerEvents: "none",
                background: "linear-gradient(to bottom, transparent, #024628)",
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
                    // Segments span between consecutive row CENTERS, which
                    // sit at (i + 0.5)/N_P — same coordinates the rows
                    // themselves are absolutely positioned at below. Each
                    // segment draws (scaleY 0→1) on entry, shortly after the
                    // row above it appears (same triggered timeline as the
                    // ingredients section).
                    const startPct = ((i + 0.5) / N_P) * 100;
                    const endPct = ((i + 1.5) / N_P) * 100;
                    const segDelay = i * 170 + 120;
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
                          background: "#024628",
                          boxShadow: "0 0 8px rgba(201,169,110,0.45)",
                          transformOrigin: "top",
                          transform: proteinRevealed ? "scaleY(1)" : "scaleY(0)",
                          transition: `transform 0.42s ease ${segDelay}ms`,
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
                      const reachAt = (i + 0.5) / N_P;
                      const reached = proteinRevealed;
                      const delay = i * 170;
                      return (
                        <div key={b.n} style={{
                          position: "absolute",
                          top: `${reachAt * 100}%`,
                          left: 0, right: 0,
                          textAlign: "center",
                          opacity: proteinRevealed ? 1 : 0,
                          transform: proteinRevealed
                            ? "translate(0, -50%)"
                            : "translate(0, calc(-50% + 8px))",
                          transition: `opacity 0.52s ease ${delay}ms, transform 0.52s ease ${delay}ms`,
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
                            transition: `color 0.5s ease ${delay}ms, text-shadow 0.5s ease ${delay}ms`,
                          }}>{b.title}</p>
                          <p style={{
                            margin: "10px 0 0",
                            fontFamily: "var(--font-body)",
                            fontSize: 16, fontWeight: 300,
                            letterSpacing: "0.05em",
                            color: reached ? "#FFF8E0" : "rgba(251,243,212,0.4)",
                            lineHeight: 1.6,
                            textShadow: reached
                              ? "0 0 8px rgba(255,222,160,0.85), 0 0 18px rgba(201,169,110,0.7), 0 0 36px rgba(201,169,110,0.4)"
                              : "none",
                            transition: `color 0.5s ease ${delay}ms, text-shadow 0.5s ease ${delay}ms`,
                          }}>{b.desc}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ══ SECTION 5 — FOUNDER (homepage only, between Phase 4 and the CTA) ══
              Foundation Green band per brand bible. Portrait + short
              personal note + gold signature + soft link to the full
              /behind-cadieux page. Confidentiality: no premix/supplier
              references — the recipe is framed as developed in-house.
              No overlap on this boundary — Phase 4's bottom benefits (Sharper
              Mind) need full dwell time before the Founder band scrolls in. */}
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
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: "#024628",
              }}>
                {FOUNDER_SIGNATURE}
              </p>

              <Link
                href="/behind-cadieux"
                style={{
                  marginTop: 32,
                  fontFamily: "var(--font-body)",
                  fontSize: 14,
                  fontWeight: 500,
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

          {/* ══ SECTION 6 — CLOSING CTA ══
              NOTE: no `content-visibility: auto` here — this section holds
              the largest background <video>, and skipping its rendering
              off-screen froze it on its first frame. Off-screen decode is
              already avoided by the play-on-enter IntersectionObserver, which
              pauses the video whenever it's fully out of view. */}
          <section style={{
            minHeight: "100dvh", display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            padding: "80px 28px", textAlign: "center", position: "relative",
            overflow: "hidden",
            zIndex: 3,
            backgroundColor: "#024628",
          }}>
            {/* Background video — deferred: preload="none" and no autoplay
                attribute, so this deepest section's file is not fetched until
                lazyPlayOnEnter sees it approach the viewport. */}
            <video ref={lazyPlayOnEnter} muted playsInline loop preload="none"
              disablePictureInPicture disableRemotePlayback
              controlsList="nodownload nofullscreen noremoteplayback"
              poster="/bread-making-01.poster.jpg"
              style={{
                position: "absolute", inset: 0, width: "100%", height: "100%",
                objectFit: "cover", zIndex: 0, backgroundColor: "#024628",
              }}>
              <source src="/bread-making-01.mp4" type="video/mp4" />
              <source src="/bread-making-01.av1.mp4" type='video/mp4; codecs="av01.0.05M.08"' />
            </video>
            {/* Dark overlay */}
            <div style={{ position: "absolute", inset: 0, background: "rgba(29,29,31,0.70)", zIndex: 1, pointerEvents: "none" }} />
            <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 2 }} />

            <img
              src="/logo-icon.webp"
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
              margin: "20px 0 0", fontFamily: "var(--font-body)", fontSize: 14,
              fontWeight: 500, letterSpacing: "0.45em", textTransform: "uppercase",
              color: "#4369B2",
            }}>Same Bread. Better Built.</p>

            <button style={{
              position: "relative", zIndex: 3,
              display: "block", width: "100%", maxWidth: 320, marginTop: 28,
              fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
              letterSpacing: "0.4em", textTransform: "uppercase",
              color: "#FBF3D4", background: "#024628",
              border: "none", padding: 18, cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
            onClick={() => router.push("/shop")}
            >Shop Now</button>
          </section>

          {/* ══ Brand / Company / Manufacturing footer ══
              Sits directly under the closing CTA. Walnut bg matches
              the closing CTA so the seam is invisible. */}
          <footer style={{
            background: "#024628",
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
                fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 200,
                letterSpacing: "0.04em", lineHeight: 1.7,
                color: "rgba(251,243,212,0.6)",
                maxWidth: 380,
              }}>
                <span style={{ display: "block", fontSize: 14, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(200,144,58,0.65)", marginBottom: 6 }}>Manufactured at</span>
                D.No. 13/18, Plot 78, PM Palem Main Road,<br />
                Revenue Ward 4, PM Palem,<br />
                Visakhapatnam, Andhra Pradesh 530041
              </p>

              <a
                href="https://instagram.com/cadieuxindia"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
                  letterSpacing: "0.3em", textTransform: "uppercase",
                  color: "#C8903A", textDecoration: "none",
                  borderBottom: "1px solid rgba(200,144,58,0.4)",
                  paddingBottom: 2,
                }}
              >@cadieuxindia</a>

              {/* ── Site links ──
                  Discoverability row for the SEO landing pages that are
                  otherwise reachable only from the homepage hamburger
                  (which doesn't render on subpages) or the sitemap.
                  Matches the Legal row's styling exactly so the footer
                  stays visually quiet — one extra row on mobile. */}
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
                  fontSize: 14, letterSpacing: "0.35em", textTransform: "uppercase",
                  color: "rgba(200,144,58,0.65)",
                  marginBottom: 4,
                }}>Site</span>
                {[
                  ["Shop", "/shop"],
                  ["Subscribe", "/subscribe"],
                  ["Store Locator", "/store-locator"],
                  ["Check Delivery", "/find-us"],
                ].map(([label, href]) => (
                  <a
                    key={href}
                    href={href}
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: 14,
                      fontWeight: 500,
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

              {/* ── Legal links ──
                  Six required policy pages. Each routes to a server-rendered
                  page that embeds the cleaned Termly HTML. /delete-account is
                  required for Google Play policy compliance. Kept compact and
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
                  fontSize: 14, letterSpacing: "0.35em", textTransform: "uppercase",
                  color: "rgba(200,144,58,0.65)",
                  marginBottom: 4,
                }}>Legal</span>
                {[
                  ["Privacy Policy", "/privacy-policy"],
                  ["Cookie Policy", "/cookies"],
                  ["Terms", "/terms"],
                  ["Refunds", "/refunds"],
                  ["Shipping", "/shipping"],
                  ["Delete Account", "/delete-account"],
                ].map(([label, href]) => (
                  <a
                    key={href}
                    href={href}
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: 14,
                      fontWeight: 500,
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

              {/* ── Copyright ──
                  Dynamic year so it never goes stale. Client component,
                  so SSR + hydration both render the same value on the
                  same day. Kept muted to sit quietly below Legal. */}
              <p style={{
                margin: "10px 0 0",
                fontFamily: "var(--font-body)",
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: "0.35em",
                textTransform: "uppercase",
                color: "rgba(251,243,212,0.4)",
              }}>© {new Date().getFullYear()} Cadieux · Visakhapatnam</p>
            </div>
          </footer>

        </div>
      </div>
    </>
  );
}
