"use client";
import { useRef, useEffect } from "react";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ss   = (e0: number, e1: number, x: number) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

const qStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-heading)",
  fontSize: "clamp(26px,6vw,44px)",
  fontWeight: 300,
  color: "#FBF3D4",
  letterSpacing: "0.04em",
  lineHeight: 1.2,
};
const aStyle: React.CSSProperties = {
  margin: "0 auto",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  lineHeight: 1.9,
  color: "rgba(251,243,212,0.8)",
  maxWidth: 300,
};

export default function QASection() {
  const outerRef = useRef<HTMLDivElement>(null);
  const q1Ref    = useRef<HTMLDivElement>(null);
  const a1Ref    = useRef<HTMLDivElement>(null);
  const q2Ref    = useRef<HTMLDivElement>(null);
  const a2Ref    = useRef<HTMLDivElement>(null);
  const q3Ref    = useRef<HTMLDivElement>(null);
  const a3Ref    = useRef<HTMLDivElement>(null);
  const dotRef   = useRef<HTMLDivElement>(null);
  const darkRef  = useRef<HTMLDivElement>(null);
  const svg1Ref  = useRef<SVGSVGElement>(null);
  const svg2Ref  = useRef<SVGSVGElement>(null);
  const svg3Ref  = useRef<SVGSVGElement>(null);
  const p1Ref    = useRef<SVGPathElement>(null);
  const p2Ref    = useRef<SVGPathElement>(null);
  const p3Ref    = useRef<SVGPathElement>(null);
  const lpRef    = useRef(0);

  /* Connector refs */
  const ln1Ref = useRef<SVGLineElement>(null);
  const ln2Ref = useRef<SVGLineElement>(null);
  const ln3Ref = useRef<SVGLineElement>(null);
  const ln4Ref = useRef<SVGLineElement>(null);
  const ln5Ref = useRef<SVGLineElement>(null);
  const ca1Ref = useRef<SVGCircleElement>(null);
  const cb1Ref = useRef<SVGCircleElement>(null);
  const ca2Ref = useRef<SVGCircleElement>(null);
  const cb2Ref = useRef<SVGCircleElement>(null);
  const ca3Ref = useRef<SVGCircleElement>(null);
  const cb3Ref = useRef<SVGCircleElement>(null);
  const ca4Ref = useRef<SVGCircleElement>(null);
  const cb4Ref = useRef<SVGCircleElement>(null);
  const ca5Ref = useRef<SVGCircleElement>(null);
  const cb5Ref = useRef<SVGCircleElement>(null);

  useEffect(() => {
    if (!document.getElementById("qa4-styles")) {
      const s = document.createElement("style");
      s.id = "qa4-styles";
      s.textContent = `@keyframes qa4-glow{0%{background-position:0% 50%}100%{background-position:100% 50%}}`;
      document.head.appendChild(s);
    }

    /* Init slash dasharray */
    const pRefs  = [p1Ref, p2Ref, p3Ref];
    const svRefs = [svg1Ref, svg2Ref, svg3Ref];
    const lens   = pRefs.map(r => r.current?.getTotalLength() ?? 142);
    pRefs.forEach((r, i) => {
      if (!r.current) return;
      r.current.style.strokeDasharray  = String(lens[i]);
      r.current.style.strokeDashoffset = String(lens[i]);
    });
    svRefs.forEach(r => { if (r.current) r.current.style.opacity = "0"; });

    /* Connector transitions config
       All Q&A motion is compressed into p 0.00–0.67 (first 400 of 600vh scroll),
       leaving A3 visible for ~200vh before the dark overlay fades in at p 0.97.  */
    const transitions = [
      { lo: 0.12, hi: 0.19, fromRef: q1Ref, toRef: a1Ref, lnRef: ln1Ref, caRef: ca1Ref, cbRef: cb1Ref },
      { lo: 0.25, hi: 0.32, fromRef: a1Ref, toRef: q2Ref, lnRef: ln2Ref, caRef: ca2Ref, cbRef: cb2Ref },
      { lo: 0.39, hi: 0.45, fromRef: q2Ref, toRef: a2Ref, lnRef: ln3Ref, caRef: ca3Ref, cbRef: cb3Ref },
      { lo: 0.51, hi: 0.56, fromRef: a2Ref, toRef: q3Ref, lnRef: ln4Ref, caRef: ca4Ref, cbRef: cb4Ref },
      { lo: 0.60, hi: 0.67, fromRef: q3Ref, toRef: a3Ref, lnRef: ln5Ref, caRef: ca5Ref, cbRef: cb5Ref },
    ] as const;

    let raf: number;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const outer = outerRef.current;
      if (!outer) return;

      const sy  = window.scrollY;
      const top = sy + outer.getBoundingClientRect().top;
      const raw = Math.min(Math.max((sy - top) / (outer.scrollHeight - window.innerHeight), 0), 1);
      lpRef.current = lerp(lpRef.current, raw, 0.08);
      const p = lpRef.current;

      /* Set a content block's opacity + diagonal offset */
      const set = (ref: React.RefObject<HTMLDivElement | null>, op: number, d: number) => {
        if (!ref.current) return;
        ref.current.style.opacity   = String(op);
        ref.current.style.transform = `translateX(${d}px) translateY(${d}px)`;
      };

      /* Each block: eIn drives enter, eOut drives exit.
         Opacity = eIn × (1 − eOut)
         Offset  = lerp(80→0, eIn) + lerp(0→-80, eOut)

         All p values scaled by 0.67 vs. the original — transitions complete
         by p≈0.67, then A3 holds for ~200vh before dark overlay at p=0.97. */
      const block = (
        ref: React.RefObject<HTMLDivElement | null>,
        inLo: number, inHi: number,
        outLo: number, outHi: number
      ) => {
        const eIn  = ss(inLo,  inHi,  p);
        const eOut = ss(outLo, outHi, p);
        set(ref, eIn * (1 - eOut), lerp(80, 0, eIn) + lerp(0, -80, eOut));
      };

      block(q1Ref, 0.00, 0.05, 0.12, 0.19);
      block(a1Ref, 0.12, 0.19, 0.25, 0.32);
      block(q2Ref, 0.25, 0.32, 0.39, 0.45);
      block(a2Ref, 0.39, 0.45, 0.51, 0.56);
      block(q3Ref, 0.51, 0.56, 0.60, 0.67);

      /* A3 only enters, never exits — stays visible until dark covers it */
      { const eIn = ss(0.60, 0.67, p); set(a3Ref, eIn, lerp(80, 0, eIn)); }

      /* Dot and dark — dark starts at 0.97 giving A3 ~200vh hold time */
      if (dotRef.current)  dotRef.current.style.opacity  = String(ss(0.98, 1.00, p));
      if (darkRef.current) darkRef.current.style.opacity = String(ss(0.97, 1.00, p) * 0.95);

      /* Slash 1: draws 0.05-0.12, fades 0.19-0.25 */
      if (svg1Ref.current && p1Ref.current) {
        const draw = ss(0.05, 0.12, p);
        const fade = ss(0.19, 0.25, p);
        p1Ref.current.style.strokeDashoffset  = String(lens[0] * (1 - draw));
        svg1Ref.current.style.opacity         = String(draw * (1 - fade));
      }
      /* Slash 2: draws 0.32-0.39, fades 0.45-0.51 */
      if (svg2Ref.current && p2Ref.current) {
        const draw = ss(0.32, 0.39, p);
        const fade = ss(0.45, 0.51, p);
        p2Ref.current.style.strokeDashoffset  = String(lens[1] * (1 - draw));
        svg2Ref.current.style.opacity         = String(draw * (1 - fade));
      }
      /* Slash 3: draws 0.56-0.60, fades 0.64-0.67 */
      if (svg3Ref.current && p3Ref.current) {
        const draw = ss(0.56, 0.60, p);
        const fade = ss(0.64, 0.67, p);
        p3Ref.current.style.strokeDashoffset  = String(lens[2] * (1 - draw));
        svg3Ref.current.style.opacity         = String(draw * (1 - fade));
      }

      /* ── Connector lines ── */
      transitions.forEach(({ lo, hi, fromRef, toRef, lnRef, caRef, cbRef }) => {
        const ln = lnRef.current;
        const ca = caRef.current;
        const cb = cbRef.current;
        const fromEl = fromRef.current;
        const toEl   = toRef.current;
        if (!ln || !ca || !cb || !fromEl || !toEl) return;

        /* Outside crossing window → hide */
        if (p < lo - 0.01 || p > hi + 0.01) {
          ln.style.opacity = "0";
          ca.style.opacity = "0";
          cb.style.opacity = "0";
          return;
        }

        /* Crossing progress 0→1 */
        const cp = Math.min(Math.max((p - lo) / (hi - lo), 0), 1);

        /* Live bounding rects of both moving elements */
        const rA = fromEl.getBoundingClientRect();
        const rB = toEl.getBoundingClientRect();
        const ax = rA.right,  ay = rA.bottom;
        const bx = rB.left,   by = rB.top;
        const dx = bx - ax,   dy = by - ay;
        const len = Math.hypot(dx, dy);

        /* Update line endpoints */
        ln.setAttribute("x1", String(ax));
        ln.setAttribute("y1", String(ay));
        ln.setAttribute("x2", String(bx));
        ln.setAttribute("y2", String(by));
        ln.style.strokeDasharray  = String(len);
        ln.style.strokeDashoffset = String(len * (1 - cp));

        /* Overall opacity: fade in at start, full in middle, fade out at end */
        const overallOp = cp < 0.15 ? cp / 0.15 : cp > 0.85 ? (1 - cp) / 0.15 : 1;
        ln.style.opacity = String(overallOp * 0.8);

        /* Circle A at Point A — fades in as line begins drawing */
        ca.setAttribute("cx", String(ax));
        ca.setAttribute("cy", String(ay));
        ca.style.opacity = String(Math.min(cp / 0.15, 1) * overallOp);

        /* Circle B at Point B — fades in as line reaches B */
        cb.setAttribute("cx", String(bx));
        cb.setAttribute("cy", String(by));
        cb.style.opacity = String(Math.max(0, (cp - 0.85) / 0.15) * overallOp);
      });
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* Centering layer — each block lives in its own absolute inset layer */
  const layer: React.CSSProperties = {
    position: "absolute", inset: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    pointerEvents: "none", zIndex: 3,
  };
  const block: React.CSSProperties = {
    width: "100%", textAlign: "center", padding: "0 32px",
    opacity: 0, willChange: "transform, opacity",
  };

  /* Diagonal slash SVG — viewBox 0 0 100 100, preserveAspectRatio none
     path M 0 100 L 100 0 = bottom-left to top-right              */
  const SlashSVG = ({ svgRef, pathRef }: { svgRef: React.RefObject<SVGSVGElement>; pathRef: React.RefObject<SVGPathElement> }) => (
    <svg ref={svgRef as React.RefObject<SVGSVGElement>}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 3, willChange: "opacity" }}
      viewBox="0 0 100 100" preserveAspectRatio="none"
    >
      <path ref={pathRef} d="M 0 100 L 100 0"
        fill="none" stroke="rgba(251,243,212,0.3)" strokeWidth="0.4"
        vectorEffect="non-scaling-stroke"
        style={{ willChange: "stroke-dashoffset" } as React.CSSProperties}
      />
    </svg>
  );

  return (
    /* 700vh = 600vh scroll range. Transitions complete by ~400vh, leaving
       ~200vh of A3 hold before the dark overlay fades in at p=0.97.       */
    <div ref={outerRef} style={{ position: "relative", height: "700vh", overflowX: "clip" }}>
      <div style={{
        position: "sticky", top: 0, height: "100dvh", overflow: "hidden",
        background: "linear-gradient(135deg,#013820 0%,#024628 40%,#035c35 70%,#024628 100%)",
        backgroundSize: "300% 300%",
        animation: "qa4-glow 8s ease-in-out infinite alternate",
      }}>
        {/* Background video */}
        <video
          autoPlay muted playsInline loop
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0 }}
        >
          <source src="/product-video-04.mp4" type="video/mp4" />
        </video>

        {/* Dark overlay over video */}
        <div style={{ position: "absolute", inset: 0, background: "rgba(6,4,2,0.75)", zIndex: 1, pointerEvents: "none" }} />
        {/* Phase 1→2 top blend: hides Phase 2 start, fades in smoothly */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "30vh", background: "linear-gradient(to bottom, #060402, transparent)", zIndex: 6, pointerEvents: "none" }} />

        {/* Grain */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, opacity: 0.07, pointerEvents: "none", zIndex: 2 }} />

        {/* Slash lines */}
        <SlashSVG svgRef={svg1Ref} pathRef={p1Ref} />
        <SlashSVG svgRef={svg2Ref} pathRef={p2Ref} />
        <SlashSVG svgRef={svg3Ref} pathRef={p3Ref} />

        {/* Q1 */}
        <div style={layer}>
          <div ref={q1Ref} style={block}><p style={qStyle}>Why do you need protein?</p></div>
        </div>

        {/* A1 */}
        <div style={layer}>
          <div ref={a1Ref} style={block}><p style={aStyle}>Protein is the foundation of every cell in your body. It repairs muscle, powers your immune system, and keeps you full for longer — without the crash.</p></div>
        </div>

        {/* Q2 */}
        <div style={layer}>
          <div ref={q2Ref} style={block}><p style={qStyle}>Why protein bread?</p></div>
        </div>

        {/* A2 */}
        <div style={layer}>
          <div ref={a2Ref} style={block}><p style={aStyle}>Most bread works against you. Cadieux works for you. Each slice delivers 7g of protein and 6g of fibre, made from real seeds and ancient grains — no Maida, no compromise. Just fuel that builds your muscles and keeps your gut thriving.</p></div>
        </div>

        {/* Q3 */}
        <div style={layer}>
          <div ref={q3Ref} style={block}><p style={qStyle}>Who is this for?</p></div>
        </div>

        {/* A3 + dot */}
        <div style={layer}>
          <div ref={a3Ref} style={block}>
            <p style={aStyle}>Everyone. Every day. For anyone ready to take one quiet step toward a stronger, happier body — starting with what is on their plate.</p>
            <div ref={dotRef} style={{ width: 6, height: 6, borderRadius: "50%", background: "#4369B2", margin: "20px auto 0", opacity: 0, willChange: "opacity" }} />
          </div>
        </div>

        {/* Connector SVG — live diagonal lines between crossing transitions */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 4, overflow: "visible" }}>
          <line ref={ln1Ref} stroke="rgba(67,105,178,0.6)" strokeWidth="1" style={{ opacity: 0 }} />
          <line ref={ln2Ref} stroke="rgba(67,105,178,0.6)" strokeWidth="1" style={{ opacity: 0 }} />
          <line ref={ln3Ref} stroke="rgba(67,105,178,0.6)" strokeWidth="1" style={{ opacity: 0 }} />
          <line ref={ln4Ref} stroke="rgba(67,105,178,0.6)" strokeWidth="1" style={{ opacity: 0 }} />
          <line ref={ln5Ref} stroke="rgba(67,105,178,0.6)" strokeWidth="1" style={{ opacity: 0 }} />
          <circle ref={ca1Ref} r="2" fill="rgba(67,105,178,0.9)" style={{ opacity: 0 }} />
          <circle ref={cb1Ref} r="2" fill="rgba(67,105,178,0.9)" style={{ opacity: 0 }} />
          <circle ref={ca2Ref} r="2" fill="rgba(67,105,178,0.9)" style={{ opacity: 0 }} />
          <circle ref={cb2Ref} r="2" fill="rgba(67,105,178,0.9)" style={{ opacity: 0 }} />
          <circle ref={ca3Ref} r="2" fill="rgba(67,105,178,0.9)" style={{ opacity: 0 }} />
          <circle ref={cb3Ref} r="2" fill="rgba(67,105,178,0.9)" style={{ opacity: 0 }} />
          <circle ref={ca4Ref} r="2" fill="rgba(67,105,178,0.9)" style={{ opacity: 0 }} />
          <circle ref={cb4Ref} r="2" fill="rgba(67,105,178,0.9)" style={{ opacity: 0 }} />
          <circle ref={ca5Ref} r="2" fill="rgba(67,105,178,0.9)" style={{ opacity: 0 }} />
          <circle ref={cb5Ref} r="2" fill="rgba(67,105,178,0.9)" style={{ opacity: 0 }} />
        </svg>

        {/* Dark fade */}
        <div ref={darkRef} style={{ position: "absolute", inset: 0, background: "#1D1D1F", opacity: 0, pointerEvents: "none", zIndex: 5 }} />
      </div>
    </div>
  );
}
