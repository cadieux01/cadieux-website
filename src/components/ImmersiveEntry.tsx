"use client";

import { useRef, useEffect, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import SplitText from "@/components/SplitText";

gsap.registerPlugin(ScrollTrigger);

/* ── Math helpers ──────────────────────────────────────────────────────────── */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const remap = (v: number, lo: number, hi: number) => clamp((v - lo) / (hi - lo), 0, 1);
const ease  = (t: number) => t < 0.5 ? 2*t*t : -1+(4-2*t)*t;

const GRAIN_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export default function ImmersiveEntry() {
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef  = useRef(0);
  const [progress, setProgress] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768 || window.matchMedia("(hover: none)").matches);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    const st = ScrollTrigger.create({
      trigger: containerRef.current,
      start: "top top", end: "bottom bottom",
      scrub: true, invalidateOnRefresh: true,
      onUpdate: (self) => { progressRef.current = self.progress; setProgress(self.progress); },
    });
    return () => st.kill();
  }, []);

  /* Refresh ScrollTrigger whenever the container height changes (mobile flip) */
  useEffect(() => { ScrollTrigger.refresh(); }, [isMobile]);

  /* ── Overlay calculations ── */
  const p  = progress;
  const si = p < 0.35 ? 0 : p < 0.65 ? 1 : 2;
  const scenes = ["01 — Hero", "02 — Texture", "03 — Packshot"];

  const sceneTagOp   = p > 0.04 ? 0.55 : 0;
  const brandOp      = p > 0.04 ? 0.70 : 0;
  const scrollHintOp = p < 0.06 ? 1 - p * 17 : 0;

  const pkIn = remap(p, 0.78, 0.90);
  const pkOp = ease(pkIn);
  const pkY  = (1 - ease(pkIn)) * 30;

  return (
    <div ref={containerRef} style={{ position: "relative", height: isMobile ? "280vh" : "500vh" }}>
      <div style={{ position: "sticky", top: 0, height: "100dvh", overflow: "hidden", background: "#060402" }}>

        {/* Vignette — tighter on mobile for drama */}
        <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none",
          background: isMobile
            ? "radial-gradient(ellipse 90% 60% at 50% 60%, transparent 18%, rgba(6,4,2,0.92) 100%)"
            : "radial-gradient(ellipse 72% 72% at 50% 50%, transparent 20%, rgba(6,4,2,0.90) 100%)" }} />

        {/* Film grain */}
        <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none",
          opacity: 0.045, backgroundImage: GRAIN_URI }} />

        {/* Scene tag — desktop only */}
        {!isMobile && (
          <div style={{ position: "absolute", top: 36, left: 48, zIndex: 10, pointerEvents: "none",
            fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 200,
            letterSpacing: "0.45em", color: "#5a4a38", textTransform: "uppercase" as const,
            opacity: sceneTagOp }}>
            {scenes[si]}
          </div>
        )}

        {/* Brand corner */}
        <div style={{
          position: "absolute", top: isMobile ? 24 : 36, right: isMobile ? 20 : 48,
          zIndex: 10, textAlign: "right" as const, opacity: brandOp, pointerEvents: "none",
        }}>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: isMobile ? 11 : 12,
            fontWeight: 300, letterSpacing: "0.25em", color: "#f0dfc8" }}>Cadieux</div>
          {!isMobile && (
            <div style={{ fontFamily: "var(--font-body)", fontSize: 8, fontWeight: 200,
              letterSpacing: "0.4em", color: "#5a4a38", marginTop: 5 }}>SAME BREAD. BETTER BUILT.</div>
          )}
        </div>

        {/* Scroll hint */}
        <div style={{ position: "absolute", bottom: isMobile ? 28 : 36, left: "50%",
          transform: "translateX(-50%)", zIndex: 10,
          display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 8,
          fontFamily: "var(--font-body)", fontSize: 8, fontWeight: 200,
          letterSpacing: "0.45em", color: "#5a4a38", textTransform: "uppercase" as const,
          opacity: scrollHintOp, pointerEvents: "none" }}>
          <span>Scroll</span>
          <div className="immersive-breathe"
            style={{ width: 1, height: isMobile ? 28 : 38,
              background: "linear-gradient(to bottom, #5a4a38, transparent)" }} />
        </div>

        {/* Progress track — desktop only */}
        {!isMobile && (
          <div style={{ position: "absolute", right: 28, top: "50%", transform: "translateY(-50%)",
            zIndex: 10, width: 1, height: 110, background: "rgba(200,144,58,0.12)", pointerEvents: "none" }}>
            <div style={{ width: "100%", height: `${p * 100}%`, background: "#c8903a" }} />
          </div>
        )}

        {/* Mobile progress dots */}
        {isMobile && (
          <div style={{ position: "absolute", bottom: 28, right: 20, zIndex: 10,
            display: "flex", flexDirection: "column" as const, gap: 6, pointerEvents: "none" }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 3, height: 3, borderRadius: "50%",
                background: si === i ? "#c8903a" : "rgba(200,144,58,0.25)",
                transition: "background 0.4s",
              }} />
            ))}
          </div>
        )}

        {/* Packshot overlay */}
        <div style={{
          position: "absolute",
          bottom: isMobile ? "7%" : "9%",
          left: isMobile ? "28px" : "50%",
          transform: isMobile ? `translateY(${pkY}px)` : `translateX(-50%) translateY(${pkY}px)`,
          textAlign: isMobile ? "left" as const : "center" as const,
          zIndex: 10,
          width: isMobile ? "calc(100vw - 120px)" : "auto",
          padding: "0",
          opacity: pkOp,
          pointerEvents: pkOp > 0.5 ? "auto" : "none",
        }}>
          <img
            src="/logo-icon.png"
            alt="Cadieux"
            style={{
              display: "block",
              margin: isMobile ? "0 0 16px" : "0 auto 16px",
              width: isMobile ? "clamp(36px, 7vw, 52px)" : "clamp(44px, 5vw, 60px)",
              height: "auto",
              pointerEvents: "none",
              filter: "invert(1) sepia(0.4) saturate(0.8) brightness(0.95)",
            }}
          />
          <div style={{
            fontFamily: "var(--font-heading)",
            fontSize: isMobile ? "clamp(52px, 15vw, 88px)" : "clamp(54px, 8.5vw, 118px)",
            fontWeight: 300, letterSpacing: "0.10em", color: "#f0dfc8", lineHeight: 1,
          }}>
            {isMobile
              ? <span>Cadieux</span>
              : <SplitText text="Cadieux" animateEntrance={false} repelStrength={120} repelRadius={180} staggerDelay={0.05} />
            }
          </div>
          <div style={{
            fontFamily: "var(--font-body)",
            fontSize: isMobile ? 9 : 8,
            fontWeight: 200,
            letterSpacing: isMobile ? "0.35em" : "0.5em",
            color: "#c8903a",
            margin: isMobile ? "12px 0 32px" : "14px 0 40px",
            textTransform: "uppercase" as const,
          }}>
            Same Bread. Better Built.
          </div>
          <button
            onClick={() => window.dispatchEvent(new Event("openShop"))}
            style={{
            display: "block",
            width: "auto",
            fontFamily: "var(--font-body)",
            fontSize: isMobile ? 11 : 10,
            fontWeight: 300,
            letterSpacing: "0.4em",
            textTransform: "uppercase" as const,
            color: "#080604",
            background: "#f0dfc8",
            padding: isMobile ? "18px 40px" : "17px 54px",
            border: "none",
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}>
            Shop Now
          </button>
        </div>

      </div>
    </div>
  );
}
