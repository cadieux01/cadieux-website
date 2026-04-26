"use client";

import { useEffect, useRef, useState } from "react";

interface LoadingScreenProps {
  onComplete: () => void;
}

const FALLBACK_MS = 6000;
// Bump above the actual video length (4s) so onEnded wins the race in
// the normal case. Fallback only fires if the video stalled or never
// started playing.

const SESSION_KEY = "cadieux_intro_played";

/**
 * LoadingScreen — full-viewport intro video, plays ONCE per session.
 *
 * Plays /logo-intro.mp4 once, then fades out and calls onComplete.
 *
 * Robustness:
 *   • Once-per-session: a sessionStorage flag prevents the intro from
 *     replaying on dev Strict-Mode re-mounts, on internal navigation
 *     back to home, and on hot reloads. Cleared when the tab closes.
 *   • iOS Safari: muted + playsInline so autoplay works inline (no fullscreen).
 *   • If the browser blocks autoplay or the file 404s / fails to decode,
 *     a fallback dismisses the screen so the site is never blocked.
 *   • `onError` short-circuits to dismiss immediately on hard failures.
 *   • Idempotent: the dismiss path runs at most once per mount.
 */
export default function LoadingScreen({ onComplete }: LoadingScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // If we've already played the intro this session, mount in the
  // already-faded state and dismiss synchronously on first effect.
  const [skip] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(SESSION_KEY) === "1";
  });
  const [fading, setFading] = useState(skip);
  const dismissedRef = useRef(false);

  useEffect(() => {
    // Already played this session — dismiss immediately, no flicker.
    if (skip) {
      onComplete();
      return;
    }

    const v = videoRef.current;

    const dismiss = () => {
      if (dismissedRef.current) return;
      dismissedRef.current = true;
      try {
        window.sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        /* Safari private mode etc. — non-fatal */
      }
      setFading(true);
      // Match the 0.5s opacity transition below.
      window.setTimeout(onComplete, 500);
    };

    if (!v) {
      dismiss();
      return;
    }

    // Re-assert muted (iOS Safari sometimes flips it during hydration races,
    // which then makes play() require a user gesture).
    v.muted = true;
    void v.play().catch(() => {
      /* fallback timer below covers autoplay-block */
    });

    const onEnded = () => dismiss();
    const onError = () => dismiss();
    v.addEventListener("ended", onEnded);
    v.addEventListener("error", onError);

    // If after FALLBACK_MS the video hasn't started or has no data, bail.
    const fallback = window.setTimeout(() => {
      if (v.currentTime === 0 || v.readyState < 2) dismiss();
    }, FALLBACK_MS);

    return () => {
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("error", onError);
      window.clearTimeout(fallback);
    };
  }, [skip, onComplete]);

  // If we're skipping the intro, render nothing — no element, no fade,
  // no second flash of the video.
  if (skip) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        backgroundColor: "#000",
        opacity: fading ? 0 : 1,
        transition: "opacity 0.5s ease",
        pointerEvents: fading ? "none" : "auto",
      }}
    >
      <video
        ref={videoRef}
        src="/logo-intro.mp4"
        autoPlay
        muted
        playsInline
        preload="auto"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          backgroundColor: "#000",
          display: "block",
        }}
      />
    </div>
  );
}
