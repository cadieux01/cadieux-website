"use client";

import { useEffect } from "react";
import { gsap } from "gsap";

interface CursorRepelOptions {
  repelStrength?: number;
  repelRadius?: number;
  returnSpeed?: number;
}

export function useCursorRepel(
  refs: React.RefObject<HTMLElement>[],
  options: CursorRepelOptions = {}
) {
  const {
    repelStrength = 65,
    repelRadius = 120,
    returnSpeed = 0.6,
  } = options;

  useEffect(() => {
    const isTouchDevice = window.matchMedia("(hover: none)").matches;
    const strengthMul = isTouchDevice ? 0.6 : 1;
    const strength = repelStrength * strengthMul;

    let rafId = 0;

    const getEls = () =>
      refs.map((r) => r.current).filter(Boolean) as HTMLElement[];

    const applyRepel = (clientX: number, clientY: number) => {
      const els = getEls();
      const vh = window.innerHeight;

      els.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > vh) return;

        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dist = Math.hypot(clientX - cx, clientY - cy);

        if (dist < repelRadius) {
          const force = 1 - dist / repelRadius;
          const angle = Math.atan2(cy - clientY, cx - clientX);
          gsap.to(el, {
            x: Math.cos(angle) * force * strength,
            y: Math.sin(angle) * force * strength,
            rotation: (Math.random() - 0.5) * force * 15,
            duration: 0.25,
            ease: "power2.out",
            overwrite: "auto",
          });
        } else {
          gsap.to(el, {
            x: 0,
            y: 0,
            rotation: 0,
            duration: returnSpeed,
            ease: "elastic.out(1, 0.4)",
            overwrite: "auto",
          });
        }
      });
    };

    const onMouseMove = (e: MouseEvent) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => applyRepel(e.clientX, e.clientY));
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!e.touches[0]) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() =>
        applyRepel(e.touches[0].clientX, e.touches[0].clientY)
      );
    };

    const onLeave = () => {
      cancelAnimationFrame(rafId);
      const els = getEls();
      els.forEach((el) => {
        gsap.to(el, {
          x: 0,
          y: 0,
          rotation: 0,
          duration: returnSpeed * 1.2,
          ease: "elastic.out(1, 0.3)",
          overwrite: "auto",
        });
      });
    };

    if (!isTouchDevice) {
      window.addEventListener("mousemove", onMouseMove, { passive: true });
      window.addEventListener("mouseleave", onLeave);
    }
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onLeave);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onLeave);
      const els = getEls();
      els.forEach((el) => gsap.killTweensOf(el));
    };
  }, [refs, repelRadius, repelStrength, returnSpeed]);
}
