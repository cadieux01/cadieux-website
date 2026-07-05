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
    // Re-assert muted imperatively — React sometimes doesn't apply the
    // muted attribute reliably before autoplay is attempted, and iOS
    // Safari can flip it during hydration races. Without this, play()
    // may require a user gesture and browsers render a native play-icon
    // overlay on the poster.
    v.muted = true;
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
        autoPlay
        muted
        playsInline
        preload="metadata"
        poster="/bread-intro.poster.jpg"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          backgroundColor: "#024628",
        }}
      >
        <source src="/bread-intro.av1.mp4" type='video/mp4; codecs="av01.0.05M.08"' />
        <source src="/bread-intro.mp4" type="video/mp4" />
      </video>

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
          color: "rgba(251,243,212,0.7)",
          padding: "8px 0 8px 8px",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        Skip
      </button>
    </div>
  );
}
