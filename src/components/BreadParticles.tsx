"use client";

import { useRef, useEffect } from "react";

interface BreadParticlesProps {
  scrollProgress: number;
}

interface WheatGrain {
  x: number;
  y: number;
  velocityY: number;
  rotation: number;
  rotationSpeed: number;
  landed: boolean;
}

interface FlourParticle {
  x: number;
  y: number;
  baseX: number;
  radius: number;
  opacity: number;
  driftSpeed: number;
  sineOffset: number;
  sineAmplitude: number;
  spawnProgress: number;
}

interface DustCloud {
  x: number;
  y: number;
  baseRadius: number;
  maxRadius: number;
  opacity: number;
  driftSpeed: number;
  spawnProgress: number;
}

interface Seed {
  x: number;
  y: number;
  width: number;
  height: number;
  sineOffset: number;
  sineSpeed: number;
  baseX: number;
}

export default function BreadParticles({ scrollProgress }: BreadParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef(scrollProgress);
  progressRef.current = scrollProgress;

  useEffect(() => {
    // Skip particles on touch devices
    if (window.matchMedia("(hover: none)").matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let isVisible = true;

    const mouse = { x: -9999, y: -9999 };

    // Resize handler
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Mouse tracking
    const onMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    window.addEventListener("mousemove", onMouseMove);

    // Visibility API
    const onVisibilityChange = () => {
      isVisible = !document.hidden;
      if (isVisible) {
        animationId = requestAnimationFrame(loop);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Initialize wheat grains
    const wheatGrains: WheatGrain[] = Array.from({ length: 8 }, () => ({
      x: canvas.width * 0.5 + (Math.random() - 0.5) * 60,
      y: canvas.height * 0.15 + (Math.random() - 0.5) * 30,
      velocityY: 0,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.04,
      landed: false,
    }));

    // Initialize flour particles
    const flourParticles: FlourParticle[] = Array.from({ length: 120 }, () => {
      const spawnProgress = 0.15 + Math.random() * 0.25;
      return {
        x: canvas.width * 0.5 + (Math.random() - 0.5) * canvas.width * 0.3,
        y: canvas.height * 0.5 + (Math.random() - 0.5) * canvas.height * 0.2,
        baseX: 0,
        radius: 1 + Math.random() * 2,
        opacity: 0,
        driftSpeed: 0.2 + Math.random() * 0.5,
        sineOffset: Math.random() * Math.PI * 2,
        sineAmplitude: 10 + Math.random() * 20,
        spawnProgress,
      };
    });
    flourParticles.forEach((p) => {
      p.baseX = p.x;
    });

    // Initialize dust clouds
    const dustClouds: DustCloud[] = Array.from({ length: 5 }, () => ({
      x: canvas.width * 0.3 + Math.random() * canvas.width * 0.4,
      y: canvas.height * 0.5 + Math.random() * canvas.height * 0.2,
      baseRadius: 40 + Math.random() * 50,
      maxRadius: 40 + Math.random() * 50,
      opacity: 0.03 + Math.random() * 0.05,
      driftSpeed: 0.1 + Math.random() * 0.2,
      spawnProgress: 0.2 + Math.random() * 0.1,
    }));

    // Initialize seeds
    const seeds: Seed[] = Array.from({ length: 12 }, () => {
      const w = 2 + Math.random() * 3;
      const x = canvas.width * 0.2 + Math.random() * canvas.width * 0.6;
      return {
        x,
        y: canvas.height * 0.6 + Math.random() * canvas.height * 0.15,
        width: w,
        height: w * 0.6,
        sineOffset: Math.random() * Math.PI * 2,
        sineSpeed: 0.5 + Math.random() * 1,
        baseX: x,
      };
    });

    let time = 0;

    const loop = () => {
      if (!isVisible) return;
      time += 0.016;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const progress = progressRef.current;

      // Draw wheat grains
      if (progress < 0.7) {
        for (const grain of wheatGrains) {
          if (grain.landed && progress > 0.3) continue;

          if (progress < 0.1) {
            // Clustered near center top - reset position
          } else if (progress >= 0.1 && progress <= 0.3 && !grain.landed) {
            grain.velocityY += 0.3;
            grain.y += grain.velocityY;
            grain.rotation += grain.rotationSpeed;

            if (grain.y > canvas.height * 0.7) {
              grain.y = canvas.height * 0.7;
              grain.landed = true;
              grain.velocityY = 0;
            }
          }

          ctx.save();
          ctx.translate(grain.x, grain.y);
          ctx.rotate(grain.rotation);
          ctx.fillStyle = "#c9922e";
          ctx.beginPath();
          ctx.ellipse(0, 0, 6, 3, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // Draw flour particles
      for (const p of flourParticles) {
        if (progress < p.spawnProgress) {
          p.opacity = 0;
          continue;
        }

        // Target opacity based on progress
        let targetOpacity = 0.1 + Math.random() * 0.05;
        if (progress > 0.4) {
          targetOpacity = 0.2 + Math.random() * 0.05;
        }
        if (progress > 0.7) {
          targetOpacity *= Math.max(0, 1 - (progress - 0.7) / 0.3);
        }
        p.opacity += (targetOpacity - p.opacity) * 0.02;

        // Movement
        p.y -= p.driftSpeed;
        p.x = p.baseX + Math.sin(time * 0.5 + p.sineOffset) * p.sineAmplitude;

        // Disperse outward at high progress
        if (progress > 0.7) {
          const disperseFactor = (progress - 0.7) / 0.3;
          p.x += (p.x - canvas.width * 0.5) * disperseFactor * 0.01;
        }

        // Reset if off screen
        if (p.y < -10) {
          p.y = canvas.height * 0.6;
          p.baseX = canvas.width * 0.5 + (Math.random() - 0.5) * canvas.width * 0.3;
          p.x = p.baseX;
        }

        // Mouse repulsion
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 150 && dist > 0) {
          const force = (1 - dist / 150) * 3;
          p.x += (dx / dist) * force;
          p.y += (dy / dist) * force;
        }

        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.fillStyle = "rgba(247,243,236,1)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Draw dust clouds
      for (const cloud of dustClouds) {
        if (progress < cloud.spawnProgress) continue;

        const age = (progress - cloud.spawnProgress) / (1 - cloud.spawnProgress);
        const currentRadius = cloud.baseRadius + age * 30;
        const currentOpacity =
          age < 0.5
            ? cloud.opacity * (age / 0.5)
            : cloud.opacity * Math.max(0, 1 - (age - 0.5) / 0.5);

        cloud.y -= cloud.driftSpeed * 0.5;

        if (currentOpacity <= 0) continue;

        ctx.save();
        ctx.globalAlpha = currentOpacity;
        try {
          ctx.filter = "blur(8px)";
        } catch {
          // filter not supported in all contexts
        }
        const gradient = ctx.createRadialGradient(
          cloud.x,
          cloud.y,
          0,
          cloud.x,
          cloud.y,
          currentRadius
        );
        gradient.addColorStop(0, "rgba(255,253,248,1)");
        gradient.addColorStop(1, "rgba(255,253,248,0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cloud.x, cloud.y, currentRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.filter = "none";
        ctx.restore();
      }

      // Draw seeds
      if (progress > 0.3) {
        const seedOpacity = Math.min(1, (progress - 0.3) / 0.1);
        ctx.globalAlpha = seedOpacity;
        ctx.fillStyle = "#4a3010";
        for (const seed of seeds) {
          const offsetX = Math.sin(time * seed.sineSpeed + seed.sineOffset) * 2;
          ctx.save();
          ctx.translate(seed.baseX + offsetX, seed.y);
          ctx.beginPath();
          ctx.ellipse(0, 0, seed.width, seed.height, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      }

      animationId = requestAnimationFrame(loop);
    };

    animationId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // Skip rendering on touch-only devices (checked at effect level too)
  if (typeof window !== "undefined" && window.matchMedia("(hover: none)").matches) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    />
  );
}
