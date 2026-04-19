"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import SplitText from "@/components/SplitTextLazy";

interface LoadingScreenProps {
  onComplete: () => void;
}

export default function LoadingScreen({ onComplete }: LoadingScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const tl = gsap.timeline({
        onComplete: () => {
          gsap.to(containerRef.current, {
            opacity: 0,
            duration: 0.5,
            ease: "power2.inOut",
            onComplete: () => {
              onComplete();
            },
          });
        },
      });

      // Word container fades in
      tl.to(wordRef.current, { opacity: 1, duration: 0.1 }, 0);

      // Hold for SplitText entrance animation to play
      tl.to({}, { duration: 0.8 });

      // Underline draws in
      tl.to(
        lineRef.current,
        {
          width: "120px",
          duration: 0.4,
          ease: "power2.out",
        },
        "-=0.1"
      );

      // Hold after line appears
      tl.to({}, { duration: 0.6 });
    },
    { scope: containerRef }
  );

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        backgroundColor: "#1d1d1f",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.2rem",
      }}
    >
      {/* Word */}
      <div
        ref={wordRef}
        style={{
          fontFamily: "var(--font-heading)",
          fontWeight: 300,
          fontSize: "clamp(3rem, 8vw, 6rem)",
          letterSpacing: "0.4em",
          color: "#fbf3d4",
          paddingRight: "0.4em",
          opacity: 0,
        }}
      >
        <SplitText
          text="CADIEUX"
          repelStrength={100}
          repelRadius={160}
          staggerDelay={0.06}
          animateEntrance={true}
        />
      </div>

      {/* Animated underline */}
      <div
        ref={lineRef}
        style={{
          width: 0,
          height: "1px",
          backgroundColor: "#436cb4",
        }}
      />
    </div>
  );
}
