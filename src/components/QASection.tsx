"use client";
import { useEffect, useRef, useState } from "react";

const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

const ss = (e0: number, e1: number, x: number) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

/* ── Q&A content ── */
const QAS = [
  {
    q: "Why do you need protein?",
    a: "Your body is built from protein. Without enough, it quietly takes from itself. With enough, it builds — every single day.",
  },
  {
    q: "Why we exist?",
    a: "For everyone choosing a stronger, healthier body without making it a project. Cadieux is that choice — baked into the bread you were already going to eat.",
  },
  {
    q: "Why protein bread?",
    a: "Most bread takes from your body. Cadieux gives back — 7g protein and 6g fibre a slice, from real seeds and ancient grains. Same morning. Better fuel.",
  },
];

/* Each Q&A occupies half of the scroll range. Generated from QAS so
   adding/removing a question doesn't require touching this table.    */
const SLICES: Array<{ enter: number; exit: number }> = QAS.map((_, i) => ({
  enter: i / QAS.length,
  exit: (i + 1) / QAS.length,
}));

/* Per-word stagger for the answer reveal. ~80ms keeps a sentence
   readable but unhurried — a 30-word answer types in ~2.4 s.         */
const WORD_STAGGER_MS = 80;
const WORD_FADE_MS = 320;

const qStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-heading)",
  fontSize: "clamp(28px,6.5vw,48px)",
  fontWeight: 300,
  color: "#FBF3D4",
  letterSpacing: "0.04em",
  lineHeight: 1.2,
  textAlign: "center",
};
const aStyle: React.CSSProperties = {
  margin: "32px auto 0",
  fontFamily: "var(--font-body)",
  fontSize: 14,
  lineHeight: 1.95,
  color: "rgba(251,243,212,0.85)",
  maxWidth: 540,
  textAlign: "center",
  padding: "0 24px",
};

export default function QASection() {
  const outerRef = useRef<HTMLDivElement>(null);
  const darkRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);

  useEffect(() => {
    /* Inject the per-word fade keyframe once. */
    if (!document.getElementById("qa-word-styles")) {
      const s = document.createElement("style");
      s.id = "qa-word-styles";
      s.textContent = `
        @keyframes qa-word-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        @keyframes qa-glow {
          0%   { background-position: 0% 50%; }
          100% { background-position: 100% 50%; }
        }
      `;
      document.head.appendChild(s);
    }

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const outer = outerRef.current;
      if (!outer) return;

      const sy = window.scrollY;
      const top = sy + outer.getBoundingClientRect().top;
      const range = outer.scrollHeight - window.innerHeight;
      const p = Math.min(Math.max((sy - top) / range, 0), 1);

      /* Active slice index. */
      let idx = 0;
      for (let i = 0; i < SLICES.length; i++) {
        if (p >= SLICES[i].enter && p < SLICES[i].exit) {
          idx = i;
          break;
        }
        if (i === SLICES.length - 1 && p >= SLICES[i].enter) idx = i;
      }
      if (idx !== activeRef.current) {
        activeRef.current = idx;
        setActive(idx);
      }

      /* Dark overlay — fades in over the last ~10 % so Phase 3 has a
         clean lead-in. The Q&A itself stays on screen until then. */
      if (darkRef.current) {
        darkRef.current.style.opacity = String(ss(0.92, 1.0, p) * 0.95);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const current = QAS[active];
  const words = current.a.split(/\s+/);

  return (
    /* 700vh outer = 600vh of scroll, plus a tail so the dark fade can
       complete cleanly before Phase 3 takes over. */
    <div ref={outerRef} style={{ position: "relative", height: "700vh", overflowX: "clip" }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          height: "100dvh",
          overflow: "hidden",
          background: "linear-gradient(135deg,#013820 0%,#024628 40%,#035c35 70%,#024628 100%)",
          backgroundSize: "300% 300%",
          animation: "qa-glow 8s ease-in-out infinite alternate",
          willChange: "transform",
          transform: "translateZ(0)",
        }}
      >
        {/* Background video */}
        <video
          ref={(el) => {
            if (!el) return;
            el.muted = true;
            const tryPlay = () => { void el.play().catch(() => {}); };
            el.addEventListener("canplay", tryPlay);
            el.addEventListener("loadeddata", tryPlay);
            tryPlay();
            if (typeof IntersectionObserver === "undefined") return;
            const io = new IntersectionObserver(
              (entries) => entries.forEach((e) => { if (e.isIntersecting) tryPlay(); }),
              { threshold: 0 }
            );
            io.observe(el);
          }}
          autoPlay
          muted
          playsInline
          loop
          preload="auto"
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover", zIndex: 0, backgroundColor: "#060402",
          }}
        >
          <source src="/product-video-06.mp4" type="video/mp4" />
        </video>

        {/* Dark video overlay */}
        <div style={{ position: "absolute", inset: 0, background: "rgba(6,4,2,0.78)", zIndex: 1, pointerEvents: "none" }} />

        {/* Phase 1 → 2 top blend */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "30vh", background: "linear-gradient(to bottom, #060402, transparent)", zIndex: 6, pointerEvents: "none" }} />

        {/* Grain */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, opacity: 0.07, pointerEvents: "none", zIndex: 2 }} />

        {/* Q & A stage — single fixed layout, content swaps on `active` change.
            Keying the wrapper with the active index re-mounts the inner
            DOM, which restarts the per-word animations from delay 0. */}
        <div
          key={active}
          style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column",
            justifyContent: "center", alignItems: "center",
            padding: "96px 24px 72px",
            zIndex: 3, pointerEvents: "none",
          }}
        >
          {/* Question — fades in as a single block at the top of the
              stage. Sits above the answer so it reads as a header. */}
          <p
            style={{
              ...qStyle,
              opacity: 0,
              animation: `qa-word-in 600ms cubic-bezier(0.19,1,0.22,1) forwards`,
            }}
          >
            {current.q}
          </p>

          {/* Answer — word by word. Each word is its own span with a
              staggered delay so the sentence types out left → right.  */}
          <p style={aStyle} aria-label={current.a}>
            {words.map((w, i) => (
              <span
                key={i}
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  opacity: 0,
                  /* Delay starts after the question has settled (~400 ms). */
                  animation: `qa-word-in ${WORD_FADE_MS}ms cubic-bezier(0.19,1,0.22,1) forwards`,
                  animationDelay: `${400 + i * WORD_STAGGER_MS}ms`,
                  whiteSpace: "pre",
                }}
              >
                {w}
                {i < words.length - 1 ? " " : ""}
              </span>
            ))}
          </p>

          {/* Slice indicator dots — quiet hint that there are more Q&As. */}
          <div style={{ display: "flex", gap: 8, marginTop: 36 }}>
            {QAS.map((_, i) => (
              <span
                key={i}
                style={{
                  width: i === active ? 18 : 6,
                  height: 6,
                  borderRadius: 999,
                  background: i === active ? "#c9a96e" : "rgba(251,243,212,0.35)",
                  transition: "all 0.4s cubic-bezier(0.19,1,0.22,1)",
                }}
              />
            ))}
          </div>
        </div>

        {/* Dark fade out → Phase 3 */}
        <div ref={darkRef} style={{ position: "absolute", inset: 0, background: "#1D1D1F", opacity: 0, pointerEvents: "none", zIndex: 5 }} />
      </div>
    </div>
  );
}
