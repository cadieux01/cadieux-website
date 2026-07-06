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
  // SSR-safe: always render the loading div on first frame so server and
  // client markup match (avoids hydration mismatch warnings). The "already
  // played this session" check happens in useEffect; if true, we dismiss
  // immediately by calling onComplete and unmount via the parent.
  const [fading, setFading] = useState(false);
  const dismissedRef = useRef(false);

  useEffect(() => {
    // Note: we deliberately do NOT clear the session flag on
    // PerformanceNavigationTiming.type === "reload". The navigation entry
    // is fixed to the original page load and never updates during SPA
    // navigation, so a "reload" entry would cause every internal nav back
    // to / to clear the flag and replay the intro. sessionStorage already
    // clears when the tab closes, which is the correct boundary: intro
    // plays once per browser session, never again until a new session.
    let alreadyPlayed = false;
    try {
      alreadyPlayed = window.sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      /* Safari private mode etc. */
    }

    // Already played this session — dismiss immediately so the parent
    // unmounts us on the next render. No fade, no video play.
    if (alreadyPlayed) {
      dismissedRef.current = true;
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
      // Signal to SiteMusic (and any other listener) that the intro has
      // ended so it can safely attach its gesture-unlock listeners. The
      // sessionStorage flag above is the source of truth on subsequent
      // mounts / navigations; this event covers the SAME-mount case
      // where SiteMusic mounted before LoadingScreen finished.
      try {
        window.dispatchEvent(new Event("cadieux:intro-done"));
      } catch {
        /* dispatchEvent virtually never throws — ignore just in case */
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
  }, [onComplete]);

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
        autoPlay
        muted
        playsInline
        preload="auto"
        poster="/logo-intro.poster.jpg"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          backgroundColor: "#000",
          display: "block",
        }}
      >
        <source src="/logo-intro.av1.mp4" type='video/mp4; codecs="av01.0.05M.08"' />
        <source src="/logo-intro.mp4" type="video/mp4" />
      </video>
    </div>
  );
}
