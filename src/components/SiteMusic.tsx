"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

// Session-storage key used by both LoadingScreen (writes it on intro
// dismiss) and here (reads it to decide when to unlock). Sharing the
// key means no matter which mounts first, the intro→music handoff
// works: same-mount races are covered by the "cadieux:intro-done"
// event; already-played sessions and non-homepage routes are covered
// by the flag / pathname check.
const INTRO_DONE_KEY = "cadieux_intro_played";
const MUTE_KEY = "cadieux_music_muted";

export default function SiteMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(true);
  const [ready, setReady] = useState(false);
  // Gate the gesture-unlock listeners on the intro video finishing.
  // Rule: on the homepage the LoadingScreen intro plays once per
  // session with its own (muted) audio track; music unlock defers
  // until that intro is out of the way so the two never overlap
  // (also gives the intro dramatic silence). On any non-homepage
  // route the intro doesn't render, so we unlock immediately.
  const [introDone, setIntroDone] = useState(false);
  const pathname = usePathname();

  // Restore mute state
  useEffect(() => {
    const saved = typeof window !== "undefined" ? sessionStorage.getItem(MUTE_KEY) : null;
    if (saved === "false") setMuted(false);
    setReady(true);
  }, []);

  // Watch for the intro finishing. Three signals cover every path:
  //   1. sessionStorage flag already set  → prior play OR "already
  //      played this session" branch inside LoadingScreen.
  //   2. pathname is NOT "/"              → intro never mounts on
  //      this route; safe to unlock now.
  //   3. "cadieux:intro-done" event fires → intro just finished on
  //      the current mount; unlock in response.
  useEffect(() => {
    if (introDone) return;
    if (typeof window === "undefined") return;

    const flagged = (() => {
      try { return sessionStorage.getItem(INTRO_DONE_KEY) === "1"; }
      catch { return false; }
    })();

    if (flagged || pathname !== "/") {
      setIntroDone(true);
      return;
    }

    const onIntroDone = () => setIntroDone(true);
    window.addEventListener("cadieux:intro-done", onIntroDone, { once: true });
    return () => window.removeEventListener("cadieux:intro-done", onIntroDone);
  }, [pathname, introDone]);

  // Sync mute state to audio + storage
  useEffect(() => {
    if (!ready) return;
    const el = audioRef.current;
    if (!el) return;
    el.muted = muted;
    el.volume = 0.35;
    sessionStorage.setItem(MUTE_KEY, String(muted));
    if (!muted) el.play().catch(() => {});
  }, [muted, ready]);

  // Start on first user interaction (autoplay-policy safe). Held
  // back until the intro is out of the way — see introDone above.
  useEffect(() => {
    if (!ready || !introDone) return;
    const el = audioRef.current;
    if (!el) return;
    const start = () => {
      el.play().catch(() => {});
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      window.removeEventListener("touchstart", start);
    };
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    window.addEventListener("touchstart", start, { once: true });
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      window.removeEventListener("touchstart", start);
    };
  }, [ready, introDone]);

  return (
    <>
      <audio ref={audioRef} src="/music/ivory-atelier.mp3" loop preload="none" />
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
          background: "rgba(29,29,31,0.65)",
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
