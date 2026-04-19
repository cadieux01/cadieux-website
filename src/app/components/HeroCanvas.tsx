"use client";

import { useRef, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AmbientParticle {
  x: number; y: number;
  vx: number; vy: number;
  radius: number;
  opacity: number;
  wobbleOffset: number;
  wobbleSpeed: number;
}

interface SplashParticle {
  x: number; y: number;
  vx: number; vy: number;
  radius: number;
  baseRadius: number;
  life: number;
  lifeDecay: number;
}

interface SliceState {
  x: number;
  startY: number;
  targetY: number;
  startRot: number;
  targetRot: number;
  delay: number;   // ms after cycle start
  scale: number;
  alpha: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function easeInCubic(t: number): number {
  return t * t * t;
}

function randBetween(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  w: number, h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ─── Draw a single bread slice at origin (0,0) ────────────────────────────────

function drawBreadSlice(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  seed: number
) {
  const r = 6;
  // Base crust fill
  roundRect(ctx, -w / 2, -h / 2, w, h, r);
  ctx.fillStyle = "#c4974a";
  ctx.fill();

  // Mid crumb layer
  roundRect(ctx, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, r - 2);
  ctx.fillStyle = "#d4a85a";
  ctx.fill();

  // Interior blob shapes (irregular crumb texture)
  const rng = (n: number) => ((Math.sin(seed * 9301 + n * 49297) * 0.5 + 0.5));
  for (let i = 0; i < 5; i++) {
    const bx = -w / 2 + 8 + rng(i * 3) * (w - 16);
    const by = -h / 2 + 6 + rng(i * 3 + 1) * (h - 12);
    const br = 4 + rng(i * 3 + 2) * 8;
    ctx.beginPath();
    ctx.ellipse(bx, by, br, br * 0.7, rng(i) * Math.PI, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(180,140,70,0.3)";
    ctx.fill();
  }

  // Holes (air pockets)
  const holeCount = 4 + Math.floor(rng(99) * 3);
  for (let i = 0; i < holeCount; i++) {
    const hx = -w / 2 + 10 + rng(i * 7) * (w - 20);
    const hy = -h / 2 + 8 + rng(i * 7 + 1) * (h - 16);
    const hr = 2 + rng(i * 7 + 2) * 4;
    ctx.beginPath();
    ctx.ellipse(hx, hy, hr, hr * 0.6, rng(i * 7 + 3) * Math.PI, 0, Math.PI * 2);
    ctx.fillStyle = "#b8863a";
    ctx.fill();
  }

  // Crust stroke
  roundRect(ctx, -w / 2, -h / 2, w, h, r);
  ctx.strokeStyle = "#5c3d1e";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Top crust shadow
  roundRect(ctx, -w / 2, -h / 2, w, h / 3, r);
  ctx.fillStyle = "rgba(50,25,5,0.25)";
  ctx.fill();
}

// ─── Draw static scene onto an offscreen canvas ───────────────────────────────

function buildStaticLayer(
  canvas: HTMLCanvasElement,
  w: number, h: number
): void {
  const ctx = canvas.getContext("2d")!;
  canvas.width = w;
  canvas.height = h;

  // Surface fill (bottom 45%)
  const surfaceY = h * 0.55;
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#1a1208";
  ctx.fillRect(0, surfaceY, w, h - surfaceY);

  // Wood grain — diagonal lines
  ctx.save();
  ctx.translate(w / 2, surfaceY + (h - surfaceY) / 2);
  ctx.rotate((2 * Math.PI) / 180);
  ctx.translate(-w / 2, -(surfaceY + (h - surfaceY) / 2));
  for (let y = surfaceY; y < h; y += 3) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.strokeStyle = "rgba(255,200,100,0.03)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();

  // Warm spotlight from above center
  const spotlight = ctx.createRadialGradient(
    w / 2, 0, 0,
    w / 2, 0, h * 0.6
  );
  spotlight.addColorStop(0, "rgba(201,169,110,0.12)");
  spotlight.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = spotlight;
  ctx.fillRect(0, 0, w, h);

  // ── Ingredients ──────────────────────────────────────────────────────────

  const rng = (seed: number) =>
    ((Math.sin(seed * 9301 + 49297) * 0.5 + 0.5));

  // Flour dust patches
  const patchPositions = [
    { px: w * 0.3, py: h * 0.72 },
    { px: w * 0.65, py: h * 0.68 },
    { px: w * 0.5, py: h * 0.80 },
    { px: w * 0.2, py: h * 0.85 },
  ];
  patchPositions.forEach(({ px, py }, i) => {
    const pr = 60 + rng(i * 11) * 40;
    const pg = ctx.createRadialGradient(px, py, 0, px, py, pr);
    pg.addColorStop(0, `rgba(245,240,232,${0.04 + rng(i * 13) * 0.04})`);
    pg.addColorStop(1, "rgba(245,240,232,0)");
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  });

  // Oat flakes
  for (let i = 0; i < 10; i++) {
    const ox = w * 0.1 + rng(i * 3) * w * 0.8;
    const oy = h * 0.6 + rng(i * 3 + 1) * h * 0.35;
    const ow = 6 + rng(i * 3 + 2) * 8;
    const oh = ow * 0.5;
    const oRot = rng(i * 5) * Math.PI * 2;
    const oAlpha = 0.5 + rng(i * 7) * 0.3;

    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(oRot);
    ctx.globalAlpha = oAlpha;
    ctx.beginPath();
    ctx.ellipse(0, 0, ow, oh, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#c4a265";
    ctx.fill();
    ctx.strokeStyle = "#8a6a2a";
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // Seeds
  for (let i = 0; i < 18; i++) {
    const sx = w * 0.25 + rng(i * 4) * w * 0.5;
    const sy = h * 0.55 + rng(i * 4 + 1) * h * 0.4;
    const sr = 1.5 + rng(i * 4 + 2) * 2.5;
    const sRot = rng(i * 4 + 3) * Math.PI * 2;
    const sAlpha = 0.4 + rng(i * 4) * 0.3;
    const sColors = ["#6b4c1e", "#8a6a2a", "#4a3010"];
    const sColor = sColors[i % 3];

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(sRot);
    ctx.globalAlpha = sAlpha;
    ctx.beginPath();
    ctx.ellipse(0, 0, sr * 2, sr, 0, 0, Math.PI * 2);
    ctx.fillStyle = sColor;
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // Wheat stalks
  const stalkDefs = [
    { sx: w * 0.18, sy: h * 0.9, rot: -20 },
    { sx: w * 0.78, sy: h * 0.88, rot: 15 },
    { sx: w * 0.62, sy: h * 0.95, rot: -8 },
  ];
  stalkDefs.forEach(({ sx, sy, rot }) => {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = "#8a6a2a";
    ctx.lineWidth = 1.5;

    // Main stem
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-4, -30, 2, -60, -2, -90);
    ctx.stroke();

    // Grain head (oval cluster)
    for (let g = 0; g < 5; g++) {
      const gx = -2 + (g % 2 === 0 ? -4 : 4);
      const gy = -80 - g * 8;
      ctx.beginPath();
      ctx.ellipse(gx, gy, 3, 5, (g % 2 === 0 ? -0.3 : 0.3), 0, Math.PI * 2);
      ctx.fillStyle = "#8a6a2a";
      ctx.fill();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  });
}

// ─── Make ambient particles ───────────────────────────────────────────────────

function makeAmbientParticles(count: number, w: number, h: number): AmbientParticle[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    vx: randBetween(-0.1, 0.1),
    vy: randBetween(-0.25, -0.08),
    radius: randBetween(0.5, 2.5),
    opacity: randBetween(0.1, 0.4),
    wobbleOffset: Math.random() * Math.PI * 2,
    wobbleSpeed: randBetween(0.005, 0.015),
  }));
}

function makeSplashParticles(count: number, lx: number, ly: number): SplashParticle[] {
  return Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = randBetween(2, 9);
    const r = randBetween(1, 4);
    return {
      x: lx, y: ly,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: r,
      baseRadius: r,
      life: 1.0,
      lifeDecay: randBetween(0.008, 0.018),
    };
  });
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HeroCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const isMobile = () => window.innerWidth < 768;

    // Offscreen canvas for static layers
    const offscreen = document.createElement("canvas");

    // Mutable state
    let w = 0, h = 0;
    let ambientParticles: AmbientParticle[] = [];
    let splashParticles: SplashParticle[] = [];
    let rafId = 0;
    let frameCount = 0;
    let alive = true; // guards against Strict Mode double-invoke
    let cycleStart = performance.now();
    let splashTriggered = false;
    let landingActive = false;
    let landingStart = 0;
    let landingX = 0, landingY = 0;

    const CYCLE_MS = 5000;
    const IMPACT_MS = 2200;

    const sliceDefs: SliceState[] = [
      {
        x: 0.5,       // proportion of w
        startY: -120,
        targetY: 0,   // proportion of h, set on resize
        startRot: -8,
        targetRot: -3,
        delay: 0,
        scale: 1,
        alpha: 1,
      },
      {
        x: 0.52,
        startY: -60,
        targetY: 0,   // set on resize
        startRot: 5,
        targetRot: 2,
        delay: 180,
        scale: 0.88,
        alpha: 0.85,
      },
    ];

    function resize() {
      if (!canvas) return;
      w = canvas.width = window.innerWidth;
      h = canvas.height = (canvas.parentElement?.clientHeight ?? window.innerHeight);
      sliceDefs[0].targetY = h * 0.56;
      sliceDefs[1].targetY = h * 0.52;
      landingX = w * 0.5;
      landingY = h * 0.58;
      buildStaticLayer(offscreen, w, h);
      const count = isMobile() ? 80 : 180;
      ambientParticles = makeAmbientParticles(count, w, h);
    }

    function resetCycle(now: number) {
      cycleStart = now;
      splashTriggered = false;
      landingActive = false;
      splashParticles = [];
    }

    function triggerSplash() {
      const count = isMobile() ? 140 : 280;
      splashParticles = makeSplashParticles(count, landingX, landingY);
      landingActive = true;
      landingStart = performance.now();
    }

    function getBreadY(def: SliceState, elapsed: number): number {
      const t = Math.max(0, elapsed - def.delay);
      const progress = Math.min(t / IMPACT_MS, 1);
      const eased = easeInCubic(progress);
      return def.startY + (def.targetY - def.startY) * eased;
    }

    function getBreadRot(def: SliceState, elapsed: number): number {
      const t = Math.max(0, elapsed - def.delay);
      const progress = Math.min(t / IMPACT_MS, 1);
      return def.startRot + (def.targetRot - def.startRot) * progress;
    }

    function draw(now: number) {
      if (!alive) return;
      rafId = requestAnimationFrame(draw);
      frameCount++;

      const elapsed = now - cycleStart;

      // Trigger splash at impact time
      if (elapsed >= IMPACT_MS && !splashTriggered) {
        splashTriggered = true;
        triggerSplash();
      }

      // New cycle
      if (elapsed >= CYCLE_MS) {
        resetCycle(now);
      }

      // ── Clear ──────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, w, h);

      // ── Layer 1: Static (surface + ingredients) ─────────────────────
      ctx.drawImage(offscreen, 0, 0);

      // ── Layer 2a: Ambient flour particles ───────────────────────────
      for (const p of ambientParticles) {
        p.wobbleOffset += p.wobbleSpeed;
        p.x += p.vx + Math.sin(p.wobbleOffset) * 0.3;
        p.y += p.vy;
        if (p.y < -5) {
          p.y = h + 5;
          p.x = Math.random() * w;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(245,240,232,${p.opacity})`;
        ctx.fill();
      }

      // ── Layer 3: Bread slices ────────────────────────────────────────
      const sliceW = w * 0.18;
      const sliceH = sliceW * 0.44;

      // Bread stays visible after landing, fades out before cycle reset
      const FADE_START = 4000;
      const FADE_END = 4800;
      let breadFadeAlpha = 1;
      if (elapsed > FADE_START) {
        breadFadeAlpha = Math.max(0, 1 - (elapsed - FADE_START) / (FADE_END - FADE_START));
      }

      // Draw back slice first (index 1), then front (index 0)
      if (breadFadeAlpha > 0) {
        [1, 0].forEach((i) => {
          const def = sliceDefs[i];
          // Clamp to landing position after impact
          const by = elapsed >= IMPACT_MS + def.delay ? def.targetY : getBreadY(def, elapsed);
          const brot = (getBreadRot(def, elapsed) * Math.PI) / 180;
          const bx = def.x * w;

          ctx.save();
          ctx.globalAlpha = def.alpha * breadFadeAlpha;
          ctx.translate(bx, by);
          ctx.rotate(brot);
          ctx.scale(def.scale, def.scale);
          drawBreadSlice(ctx, sliceW, sliceH, i + 1);
          ctx.restore();
          ctx.globalAlpha = 1;
        });
      }

      // ── Landing effects ──────────────────────────────────────────────
      if (landingActive) {
        const lt = performance.now() - landingStart;

        // Flash (0–120ms show, 120–320ms fade)
        if (lt < 320) {
          const flashOpacity =
            lt < 120
              ? (lt / 120) * 0.18
              : 0.18 * (1 - (lt - 120) / 200);
          const flashGrad = ctx.createRadialGradient(
            landingX, landingY, 0,
            landingX, landingY, 180
          );
          flashGrad.addColorStop(0, `rgba(255,250,240,${flashOpacity})`);
          flashGrad.addColorStop(1, "rgba(255,250,240,0)");
          ctx.fillStyle = flashGrad;
          ctx.beginPath();
          ctx.arc(landingX, landingY, 180, 0, Math.PI * 2);
          ctx.fill();
        }

        // Shockwave ring (0–400ms)
        if (lt < 400) {
          const ringProgress = lt / 400;
          const ringR = ringProgress * 200;
          const ringAlpha = (1 - ringProgress) * 0.12;
          ctx.beginPath();
          ctx.arc(landingX, landingY, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(245,240,232,${ringAlpha})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Splash particles
        splashParticles = splashParticles.filter((p) => p.life > 0);
        for (const p of splashParticles) {
          p.vy += 0.12;
          p.vx *= 0.99;
          p.x += p.vx;
          p.y += p.vy;
          p.life -= p.lifeDecay;
          const pr = p.baseRadius * p.life;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(pr, 0.1), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(245,240,232,${p.life * 0.9})`;
          ctx.fill();
        }
      }

      // ── Post-processing ──────────────────────────────────────────────

      // Vignette
      const vig = ctx.createRadialGradient(
        w / 2, h / 2, h * 0.25,
        w / 2, h / 2, Math.max(w, h) * 0.75
      );
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      // Film grain (every 3 frames, skip on mobile)
      if (frameCount % 3 === 0 && !isMobile()) {
        const grainCount = 800;
        ctx.fillStyle = "rgba(0,0,0,0.03)";
        for (let g = 0; g < grainCount; g++) {
          ctx.fillRect(
            Math.random() * w,
            Math.random() * h,
            1, 1
          );
        }
      }
    }

    // ── Init ─────────────────────────────────────────────────────────────────
    resize();
    resetCycle(performance.now());
    draw(performance.now());

    const onResize = () => {
      resize();
    };
    window.addEventListener("resize", onResize);

    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        display: "block",
      }}
    />
  );
}
