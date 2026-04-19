"use client";

import { useRef, useEffect, useMemo, memo } from "react";
import { gsap } from "gsap";

interface SplitTextProps {
  text: string;
  className?: string;
  style?: React.CSSProperties;
  repelStrength?: number;
  repelRadius?: number;
  returnSpeed?: number;
  repelSpeed?: number;
  staggerDelay?: number;
  animateEntrance?: boolean;
  wordMode?: boolean;
}

function getChars(container: HTMLElement): HTMLSpanElement[] {
  return Array.from(container.querySelectorAll<HTMLSpanElement>("[data-char]"));
}

const SplitTextInner = memo(function SplitText({
  text,
  className = "",
  style = {},
  repelStrength = 65,
  repelRadius = 120,
  returnSpeed = 0.6,
  repelSpeed = 0.25,
  staggerDelay = 0.03,
  animateEntrance = true,
  wordMode = false,
}: SplitTextProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const entranceDone = useRef(false);

  // Entrance animation
  useEffect(() => {
    if (!animateEntrance || entranceDone.current) return;
    const container = containerRef.current;
    if (!container) return;

    const id = requestAnimationFrame(() => {
      const chars = getChars(container);
      if (!chars.length) return;
      entranceDone.current = true;

      gsap.fromTo(
        chars,
        { opacity: 0, y: 18 },
        {
          opacity: 1,
          y: 0,
          duration: 0.6,
          stagger: staggerDelay,
          ease: "power2.out",
          delay: 0.1,
        }
      );
    });

    return () => cancelAnimationFrame(id);
  }, [animateEntrance, staggerDelay, text]);

  // If not animating entrance, set initial visible state
  useEffect(() => {
    if (animateEntrance) return;
    const container = containerRef.current;
    if (!container) return;
    const id = requestAnimationFrame(() => {
      const chars = getChars(container);
      chars.forEach((el) => gsap.set(el, { opacity: 1, y: 0 }));
    });
    return () => cancelAnimationFrame(id);
  }, [animateEntrance, text]);

  // Cursor repel — listeners on window
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isTouchDevice = window.matchMedia("(hover: none)").matches;
    const strengthMultiplier = isTouchDevice ? 0.6 : 1;
    const effectiveStrength = (wordMode ? repelStrength * 0.5 : repelStrength) * strengthMultiplier;

    let rafId = 0;

    const applyRepel = (clientX: number, clientY: number) => {
      const chars = getChars(container);
      const vh = window.innerHeight;

      chars.forEach((el) => {
        const rect = el.getBoundingClientRect();
        // Skip off-viewport chars
        if (rect.bottom < 0 || rect.top > vh) return;

        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dist = Math.hypot(clientX - cx, clientY - cy);

        if (dist < repelRadius) {
          const force = 1 - dist / repelRadius;
          const angle = Math.atan2(cy - clientY, cx - clientX);
          const dx = Math.cos(angle) * force * effectiveStrength;
          const dy = Math.sin(angle) * force * effectiveStrength;
          const rot = (Math.random() - 0.5) * force * 25;

          gsap.to(el, {
            x: dx,
            y: dy,
            rotation: rot,
            duration: repelSpeed,
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
      rafId = requestAnimationFrame(() => {
        applyRepel(e.clientX, e.clientY);
      });
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!e.touches[0]) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        applyRepel(e.touches[0].clientX, e.touches[0].clientY);
      });
    };

    const onLeave = () => {
      cancelAnimationFrame(rafId);
      const chars = getChars(container);
      chars.forEach((el) => {
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
      // Kill all tweens on chars
      const chars = getChars(container);
      chars.forEach((el) => gsap.killTweensOf(el));
    };
  }, [repelRadius, repelStrength, repelSpeed, returnSpeed, wordMode]);

  // Pre-compute word/char structure
  const wordData = useMemo(() => {
    if (wordMode) {
      const words = text.split(" ");
      return words.map((word, wi) => ({
        type: "word" as const,
        word,
        wi,
      }));
    }

    const words = text.split(" ");
    let idx = 0;
    return words.map((word, wi) => {
      const chars = word.split("").map((char) => ({ char, idx: idx++ }));
      const spaceIdx = wi < words.length - 1 ? idx++ : -1;
      return { type: "chars" as const, chars, spaceIdx, wi };
    });
  }, [text, wordMode]);

  return (
    <span
      ref={containerRef}
      className={className}
      style={{ ...style, cursor: "default" }}
    >
      {wordMode
        ? (wordData as { type: "word"; word: string; wi: number }[]).map(
            ({ word, wi }) => (
              <span
                key={wi}
                data-char={wi}
                style={{
                  display: "inline-block",
                  marginRight: "0.25em",
                  willChange: "transform",
                }}
              >
                {word}
              </span>
            )
          )
        : (
            wordData as {
              type: "chars";
              chars: { char: string; idx: number }[];
              spaceIdx: number;
              wi: number;
            }[]
          ).map(({ chars, spaceIdx, wi }) => (
            <span
              key={wi}
              style={{ display: "inline-block", whiteSpace: "nowrap" }}
            >
              {chars.map(({ char, idx }) => (
                <span
                  key={idx}
                  data-char={idx}
                  style={{
                    display: "inline-block",
                    willChange: "transform",
                  }}
                >
                  {char}
                </span>
              ))}
              {spaceIdx >= 0 && (
                <span
                  key={`s${wi}`}
                  data-char={spaceIdx}
                  style={{ display: "inline-block", willChange: "transform" }}
                >
                  {"\u00A0"}
                </span>
              )}
            </span>
          ))}
    </span>
  );
});

export default SplitTextInner;
