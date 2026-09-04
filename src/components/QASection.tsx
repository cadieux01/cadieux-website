"use client";
import { useEffect, useRef, useState } from "react";
import { lazyPlayOnEnter } from "@/lib/lazyVideo";

const GRAIN = "url(/grain.svg)";

const ss = (e0: number, e1: number, x: number) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

/* ── Q&A content ── */
const QAS = [
  {
    q: "Why do you need protein?",
    a: "Protein is what holds you together. Muscle that moves you. Focus that sharpens you. Steadiness that carries you through the day. Fall short, and the body borrows from itself. Meet it, and every part stays strong.",
  },
  {
    q: "Why we exist?",
    a: "We exist to make strength simple. The same bread you love, built better — real grains, honest protein, no shortcuts. A quiet daily ritual for anyone growing stronger, sharper, steadier, without giving up the food they hold close.",
  },
  {
    q: "Why protein bread?",
    a: "Bread is already part of your morning. We made it work harder. Real seeds, ancient grains, honest protein baked into every slice. Same routine. More strength.",
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
  fontSize: 16,
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
      `;
      document.head.appendChild(s);
    }

    /* Geometry is cached and only re-measured on resize/load. Reading
       getBoundingClientRect / scrollHeight / innerHeight *inside* the rAF
       tick forced a layout reflow every frame (flagged by the audit); the
       element's absolute top and scroll range don't change while scrolling,
       so measure once and reuse. */
    let raf = 0;
    let lastSy = -1;
    let cachedTop = 0;
    let cachedRange = 1;
    const measure = () => {
      const outer = outerRef.current;
      if (!outer) return;
      cachedTop = window.scrollY + outer.getBoundingClientRect().top;
      cachedRange = Math.max(outer.scrollHeight - window.innerHeight, 1);
    };
    measure();
    window.addEventListener("resize", measure, { passive: true });
    window.addEventListener("load", measure);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const sy = window.scrollY;
      if (sy === lastSy) return; // idle frame — no work, no reflow
      lastSy = sy;
      const p = Math.min(Math.max((sy - cachedTop) / cachedRange, 0), 1);

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
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("load", measure);
    };
  }, []);

  const current = QAS[active];
  // Words wrapped in **double asterisks** render bold (used to emphasise
  // key phrases inside an answer). Closing markers may appear before
  // trailing punctuation — e.g. "word**." — so we strip every "**"
  // anywhere in the word and toggle a running bold flag.
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
       and a single more swipe to bring in Phase 3, no dead scroll.

       NOTE: do NOT put `content-visibility: auto` on this wrapper. It
       contains the section's background <video>; skipping its rendering
       off-screen leaves the video frozen on its first frame and it never
       resumes on re-entry. */
    <div ref={outerRef} style={{
      position: "relative", height: "470vh", overflowX: "clip",
    }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          height: "100dvh",
          overflow: "hidden",
          background: "linear-gradient(135deg,#024628 0%,#024628 40%,#035c35 70%,#024628 100%)",
          /* Static gradient. The former `qa-glow` animation shifted
             background-position every frame — a full-surface repaint behind
             the sticky Q&A that never composited on the GPU. Dropped. */
          transform: "translateZ(0)",
        }}
      >
        {/* Background video — deferred: preload="none" and no autoplay
            attribute, so nothing is fetched until lazyPlayOnEnter sees it
            approach the viewport. The poster covers the wait, and once it
            starts it plays for the life of the page and never pauses. */}
        <video
          ref={lazyPlayOnEnter}
          muted
          playsInline
          loop
          preload="none"
          disablePictureInPicture
          disableRemotePlayback
          controlsList="nodownload nofullscreen noremoteplayback"
          poster="/product-video-06.poster.jpg"
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover", zIndex: 0, backgroundColor: "#024628",
          }}
        >
          <source src="/product-video-06.mp4" type="video/mp4" />
          <source src="/product-video-06.av1.mp4" type='video/mp4; codecs="av01.0.05M.08"' />
        </video>

        {/* Dark video overlay */}
        <div style={{ position: "absolute", inset: 0, background: "rgba(29,29,31,0.78)", zIndex: 1, pointerEvents: "none" }} />

        {/* FIX 1 (Task F v2 follow-up): removed Phase 1 → 2 top blend
            (linear-gradient(to bottom, #024628, transparent)) — was
            reading as a green wash rising up into the hero video from
            below. The QA section's own background handles the seam. */}

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
              staggered delay so the sentence types out left → right.
              `aria-label` on a generic <p> is a prohibited ARIA attribute
              (flagged by the audit); instead a visually-hidden span carries
              the full answer for screen readers while the animated per-word
              spans stay aria-hidden. */}
          <p style={aStyle}>
            <span
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                padding: 0,
                margin: -1,
                overflow: "hidden",
                clip: "rect(0 0 0 0)",
                whiteSpace: "nowrap",
                border: 0,
              }}
            >
              {current.a.replace(/\*\*/g, "")}
            </span>
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
        <div ref={darkRef} style={{ position: "absolute", inset: 0, background: "#024628", opacity: 0, pointerEvents: "none", zIndex: 5 }} />
      </div>
    </div>
  );
}
