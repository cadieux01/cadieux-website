"use client";

import { useEffect, useRef, useState } from "react";

export default function SiteMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(true);
  const [ready, setReady] = useState(false);

  // Restore mute state
  useEffect(() => {
    const saved = typeof window !== "undefined" ? sessionStorage.getItem("cadieux_music_muted") : null;
    if (saved === "false") setMuted(false);
    setReady(true);
  }, []);

  // Sync mute state to audio + storage
  useEffect(() => {
    if (!ready) return;
    const el = audioRef.current;
    if (!el) return;
    el.muted = muted;
    el.volume = 0.35;
    sessionStorage.setItem("cadieux_music_muted", String(muted));
    if (!muted) el.play().catch(() => {});
  }, [muted, ready]);

  // Start on first user interaction (autoplay-policy safe)
  useEffect(() => {
    if (!ready) return;
    const el = audioRef.current;
    if (!el) return;
    const start = () => {
      el.play().catch(() => {});
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
  }, [ready]);

  return (
    <>
      <audio ref={audioRef} src="/background-music.mp3" loop preload="none" />
      <button
        onClick={() => setMuted(m => !m)}
        aria-label={muted ? "Unmute music" : "Mute music"}
        style={{
          position: "fixed",
          bottom: 20,
          // Moved to the LEFT corner — the bottom-right is now owned by
          // the FloatingCartButton. `max(...)` keeps the visual 20px gap
          // on phones without a notch but pushes the button inward on
          // iPhones with a left safe-area inset (landscape orientation).
          left: "max(20px, env(safe-area-inset-left))",
          zIndex: 200,
          width: 42,
          height: 42,
          borderRadius: "50%",
          background: "rgba(6,4,2,0.65)",
          border: "1px solid rgba(240,223,200,0.25)",
          color: "#FBF3D4",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          WebkitTapHighlightColor: "transparent",
          padding: 0,
        }}
      >
        {muted ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H2v6h4l5 4V5z" />
            <line x1="22" y1="9" x2="16" y2="15" />
            <line x1="16" y1="9" x2="22" y2="15" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H2v6h4l5 4V5z" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
        )}
      </button>
    </>
  );
}
