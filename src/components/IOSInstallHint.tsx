"use client";

// iOS install hint — Safari has no beforeinstallprompt, so we show a
// one-time tooltip teaching the Share → Add to Home Screen flow.
//
// Suppressed when:
//   • Already installed (navigator.standalone === true OR display-mode: standalone)
//   • Not iOS Safari (we don't show this in Chrome on iOS — different UI)
//   • Previously dismissed on this device
//   • Visit count < 2 (don't ambush first-time visitors)

import { useEffect, useState } from "react";

const DISMISS_KEY = "cdx_pwa_ios_hint_dismissed";
const VISITS_KEY = "cdx_pwa_visits"; // shared with AndroidInstallPrompt
const VISITS_THRESHOLD = 2;

function isIOSSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPad on iOS 13+ reports as Mac; check touch points for that case.
  type IOSNav = Navigator & { maxTouchPoints?: number };
  const isIPadOS = ua.includes("Mac") && ((navigator as IOSNav).maxTouchPoints ?? 0) > 1;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || isIPadOS;
  if (!isIOS) return false;
  // Safari (not Chrome/Firefox/etc on iOS — those use WebKit but lack
  // the Share → Add to Home Screen flow that produces a real PWA).
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return isSafari;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  type IOSNav = Navigator & { standalone?: boolean };
  return (navigator as IOSNav).standalone === true;
}

export default function IOSInstallHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isIOSSafari()) return;
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY) === "1") return;

    let visits = 0;
    try {
      visits = parseInt(localStorage.getItem(VISITS_KEY) ?? "0", 10) || 0;
    } catch {
      /* ignore */
    }
    if (visits < VISITS_THRESHOLD) return;

    // Slight delay so the hint doesn't fight with first-paint animations.
    const t = window.setTimeout(() => setVisible(true), 1500);
    return () => window.clearTimeout(t);
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Install Cadieux on iPhone"
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        bottom: "calc(16px + env(safe-area-inset-bottom))",
        zIndex: 9000,
        maxWidth: 420,
        margin: "0 auto",
        background: "#1a2e1a",
        color: "#f5f0e8",
        border: "1px solid rgba(201,169,110,0.28)",
        borderRadius: 6,
        padding: "14px 16px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.02em" }}>
            Install Cadieux on your iPhone
          </div>
          <div style={{ fontSize: 11, color: "rgba(245,240,232,0.7)", marginTop: 6, lineHeight: 1.5 }}>
            Tap{" "}
            <span aria-hidden style={{ display: "inline-flex", alignItems: "center", verticalAlign: "middle" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c9a96e" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3v12" />
                <path d="M7 8l5-5 5 5" />
                <rect x="4" y="13" width="16" height="8" rx="2" />
              </svg>
            </span>{" "}
            in Safari, then choose{" "}
            <span style={{ color: "#c9a96e" }}>Add to Home Screen</span>.
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          style={{
            background: "transparent",
            color: "rgba(245,240,232,0.55)",
            border: "none",
            padding: 4,
            fontSize: 16,
            cursor: "pointer",
            lineHeight: 1,
            fontFamily: "var(--font-body)",
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
