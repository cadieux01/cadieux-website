"use client";

import { useRef, useEffect, useState } from "react";

export default function VideoIntro({ onDone }: { onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [opacity, setOpacity] = useState(1);

  const dismiss = () => {
    setOpacity(0);
    setTimeout(onDone, 1200);
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => {});
    v.addEventListener("ended", dismiss);
    return () => v.removeEventListener("ended", dismiss);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgb(6,4,2)",
        opacity,
        transition: "opacity 1.2s ease",
        pointerEvents: opacity < 0.05 ? "none" : "auto",
      }}
    >
      <video
        ref={videoRef}
        src="/bread-intro.mp4"
        autoPlay
        muted
        playsInline
        preload="metadata"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          backgroundColor: "#060402",
        }}
      />

      {/* Skip button */}
      <button
        onClick={dismiss}
        style={{
          position: "absolute",
          bottom: 32,
          right: 28,
          background: "none",
          border: "none",
          cursor: "pointer",
          fontFamily: "var(--font-body)",
          fontSize: 9,
          fontWeight: 200,
          letterSpacing: "0.45em",
          textTransform: "uppercase",
          color: "rgb(200,144,58)",
          padding: "8px 0 8px 8px",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        Skip
      </button>
    </div>
  );
}
