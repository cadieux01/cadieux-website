"use client";

import { useRef, useEffect, useCallback } from "react";
import gsap from "gsap";

interface Benefit {
  icon: string;
  title: string;
  detail: string;
}

interface IngredientData {
  name: string;
  descriptor: string;
  side: string;
  color: string;
  benefits: Benefit[];
}

interface IngredientCardProps {
  ingredient: IngredientData | null;
  anchorRect: DOMRect | null;
  side: "left" | "right";
  onClose: () => void;
}

export default function IngredientCard({
  ingredient,
  anchorRect,
  side,
  onClose,
}: IngredientCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const isClosing = useRef(false);

  // Entrance animation
  useEffect(() => {
    if (!cardRef.current || !ingredient) return;
    gsap.fromTo(
      cardRef.current,
      { opacity: 0, scale: 0.92, y: 8 },
      { opacity: 1, scale: 1, y: 0, duration: 0.35, ease: "power3.out" }
    );
  }, [ingredient]);

  // Close with exit animation
  const animateClose = useCallback(() => {
    if (isClosing.current || !cardRef.current) return;
    isClosing.current = true;
    gsap.to(cardRef.current, {
      opacity: 0,
      scale: 0.94,
      y: 6,
      duration: 0.25,
      ease: "power2.in",
      onComplete: () => {
        isClosing.current = false;
        onClose();
      },
    });
  }, [onClose]);

  // Close on outside click
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (!cardRef.current) return;
      if (!cardRef.current.contains(e.target as Node)) {
        animateClose();
      }
    };
    // Delay listener to avoid catching the same click that opened it
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleMouseDown);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [animateClose]);

  if (!ingredient || !anchorRect) return null;

  // Position calculation
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  const desktopStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        width: "100%",
        maxHeight: "65vh",
        overflowY: "auto",
        borderRadius: "12px 12px 0 0",
        zIndex: 100,
      }
    : (() => {
        const cardWidth = 280;
        const gap = 16;
        let left: number | undefined;
        let right: number | undefined;
        let top = anchorRect.top - 20;

        if (side === "left") {
          left = anchorRect.right + gap;
        } else {
          left = anchorRect.left - cardWidth - gap;
        }

        // Clamp to viewport
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (left !== undefined && left + cardWidth > vw - 16) {
          left = vw - cardWidth - 16;
        }
        if (left !== undefined && left < 16) left = 16;
        if (top < 16) top = 16;
        if (top + 400 > vh) top = vh - 400;

        return {
          position: "fixed" as const,
          left: left !== undefined ? `${left}px` : undefined,
          right: right !== undefined ? `${right}px` : undefined,
          top: `${top}px`,
          width: `${cardWidth}px`,
          zIndex: 100,
        };
      })();

  return (
    <div
      ref={cardRef}
      style={{
        ...desktopStyle,
        background: "rgba(8, 5, 2, 0.92)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        border: "1px solid rgba(201,146,46,0.25)",
        borderRadius: isMobile ? "12px 12px 0 0" : "3px",
        padding: "1.6rem",
        opacity: 0,
      }}
    >
      {/* Top row: name + close */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "1.2rem",
            color: "#fbf3d4",
          }}
        >
          {ingredient.name}
        </span>
        <button
          onClick={animateClose}
          style={{
            background: "none",
            border: "none",
            fontFamily: "var(--font-body)",
            fontSize: "1rem",
            color: "rgba(251,243,212,0.4)",
            cursor: "pointer",
            padding: "0 4px",
            lineHeight: 1,
            transition: "color 0.2s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "#c9922e";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color =
              "rgba(251,243,212,0.4)";
          }}
        >
          ×
        </button>
      </div>

      {/* Gold line */}
      <div
        style={{
          width: "100%",
          height: "1px",
          background: "linear-gradient(to right, #c9922e, transparent)",
          margin: "0.8rem 0",
        }}
      />

      {/* Benefits */}
      {ingredient.benefits.map((benefit, i) => (
        <div
          key={i}
          style={{ marginBottom: i < 2 ? "1rem" : 0 }}
        >
          <div style={{ marginBottom: "3px" }}>
            <span
              style={{
                color: ingredient.color,
                fontSize: "1rem",
                marginRight: "8px",
                verticalAlign: "middle",
              }}
            >
              {benefit.icon}
            </span>
            <span
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.875rem",
                fontWeight: 500,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "#c9922e",
              }}
            >
              {benefit.title}
            </span>
          </div>
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "1rem",
              fontWeight: 300,
              lineHeight: 1.6,
              color: "rgba(251,243,212,0.65)",
              paddingLeft: "18px",
            }}
          >
            {benefit.detail}
          </div>
        </div>
      ))}

      {/* Bottom label */}
      <div
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "0.875rem",
          fontWeight: 500,
          letterSpacing: "0.18em",
          color: "rgba(251,243,212,0.2)",
          textTransform: "uppercase",
          marginTop: "1.2rem",
          textAlign: "center",
        }}
      >
        CORE ELEMENT — HIGH PROTEIN BREAD
      </div>
    </div>
  );
}
