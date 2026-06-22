"use client";
import { useEffect, useRef, useState } from "react";

const GRAIN = "url(/grain.svg)";

const ss = (e0: number, e1: number, x: number) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

/* ── Q&A content ── */
const QAS = [
  {
    q: "Why do you need protein?",
    a: "Protein holds your body together — muscles that move you, hormones that steady you, immunity that guards you, and **blood sugar it keeps in check**. Run short, and the body breaks itself down to keep going. Eat enough — every part stays intact.",
  },
  {
    q: "Why we exist?",
    a: "We exist to make strength simple. Same bread, better built — real grains, honest protein, no shortcuts. A quiet daily ritual for anyone choosing to grow stronger, sharper, steadier — without giving up the food they hold dear.",
  },
  {
    q: "Why protein bread?",
    a: "Most bread takes from your body. Cadieux gives back — high protein and rich fibre from real seeds and ancient grains. Same morning. Better fuel.",
  },
];

/* Quick transitions for the early Q&As, then a short dwell tail on the
   last one so its answer can finish typing — but only ONE more swipe
   advances to Phase 3 (no extra dead scroll after typing). STEP is the
   fraction of total progress allotted to each non-final slice; the
   final slice owns everything after the last STEP boundary. */
const STEP = 0.23;
const SLICES: Array<{ enter: number; exit: number }> = QAS.map((_, i) => ({
  enter: i * STEP,
  exit: i === QAS.length - 1 ? 1 : (i + 1) * STEP,
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

      /* Dark overlay — fades in over the last 100vh of scroll, lined up
         with Phase 3's -100vh overlap so the Q&A is fully readable
         until the lead-in begins. */
      if (darkRef.current) {
        darkRef.current.style.opacity = String(ss(0.73, 1.0, p) * 0.95);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const current = QAS[active];
  // Words wrapped in **double asterisks** render bold (used to emphasise key
  // promises like "blood sugar it keeps in check"). Closing markers may
  // appear before trailing punctuation — e.g. "check**." — so we strip
  // every "**" anywhere in the word and toggle a running bold flag.
  let boldOpen = false;
  const words = current.a.split(/\s+/).map(w => {
    let text = w;
    let isBold = boldOpen;
    while (text.includes("**")) {
      const idx = text.indexOf("**");
      text = text.slice(0, idx) + text.slice(idx + 2);
      boldOpen = !boldOpen;
      // A word that contains a marker is bold (covers both the opening
      // word like "**blood" and the closing word like "check**.").
      isBold = true;
    }
    return { text, bold: isBold };
  });

  return (
    /* 470vh outer = ~85vh per early Q&A (one trackpad swipe advances)
       plus ~100vh tail on the final answer — enough for typing to land
       and a single more swipe to bring in Phase 3, no dead scroll. */
    <div ref={outerRef} style={{ position: "relative", height: "470vh", overflowX: "clip" }}>
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
            let shouldPlay = false;
            const tryPlay = () => {
              if (!shouldPlay) return;
              void el.play().catch(() => {});
            };
            el.addEventListener("canplay", tryPlay);
            el.addEventListener("loadeddata", tryPlay);
            if (typeof IntersectionObserver === "undefined") {
              shouldPlay = true;
              tryPlay();
              return;
            }
            const io = new IntersectionObserver(
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
            io.observe(el);
          }}
          muted
          playsInline
          loop
          preload="metadata"
          poster="/product-video-06.poster.jpg"
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover", zIndex: 0, backgroundColor: "#060402",
          }}
        >
          <source src="/product-video-06.av1.mp4" type='video/mp4; codecs="av01.0.05M.08"' />
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
          <p style={aStyle} aria-label={current.a.replace(/\*\*/g, "")}>
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
                  fontWeight: w.bold ? 600 : undefined,
                  color: w.bold ? "#FBF3D4" : undefined,
                }}
              >
                {w.text}
                {i < words.length - 1 ? " " : ""}
              </span>
            ))}
          </p>

        </div>

        {/* Dark fade out → Phase 3 */}
        <div ref={darkRef} style={{ position: "absolute", inset: 0, background: "#1D1D1F", opacity: 0, pointerEvents: "none", zIndex: 5 }} />
      </div>
    </div>
  );
}
