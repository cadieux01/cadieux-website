"use client";

// Android / Chrome install prompt.
//
// UX:
//   • Listens for `beforeinstallprompt`. If the browser fires it (Chrome /
//     Edge / Samsung Internet on Android, plus desktop Chrome), we stash the
//     deferred event and DON'T show anything yet — we wait until the user
//     has shown intent.
//   • Trigger: visit count >= 3 (counted in localStorage, ticks once per
//     pageload). This avoids spamming first-time visitors.
//   • One dismissal sticks: if the user closes the toast, we record it and
//     never show again on this device. No nag. They can still install via
//     the browser menu.
//   • Already standalone? Bail out — `display-mode: standalone` means the
//     app is installed.

import { useEffect, useState } from "react";

const VISITS_KEY = "cdx_pwa_visits";
const DISMISS_KEY = "cdx_pwa_install_dismissed";
const VISITS_THRESHOLD = 3;

// Chrome's BeforeInstallPromptEvent isn't in lib.dom yet. Minimal shape we use.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS Safari uses navigator.standalone but this component is Android-focused;
  // checking it here just keeps the prompt suppressed when Android Chrome
  // somehow fires beforeinstallprompt inside an installed PWA shell.
  type IOSNav = Navigator & { standalone?: boolean };
  return (navigator as IOSNav).standalone === true;
}

export default function AndroidInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY) === "1") return;

    // Increment visit counter once per page load.
    let visits = 0;
    try {
      visits = parseInt(localStorage.getItem(VISITS_KEY) ?? "0", 10) || 0;
    } catch {
      /* private mode etc. */
    }
    visits += 1;
    try {
      localStorage.setItem(VISITS_KEY, String(visits));
    } catch {
      /* ignore */
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      const ev = e as BeforeInstallPromptEvent;
      setDeferred(ev);
      // Only surface the toast once the user has visited enough times.
      if (visits >= VISITS_THRESHOLD) setVisible(true);
    };

    const onInstalled = () => {
      // App got installed (via our prompt or the browser menu) — clean up.
      setVisible(false);
      setDeferred(null);
      try {
        localStorage.setItem(DISMISS_KEY, "1");
      } catch {
        /* ignore */
      }
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const install = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        // appinstalled handler will tidy up.
      } else {
        dismiss();
      }
    } catch {
      dismiss();
    } finally {
      setDeferred(null);
    }
  };

  if (!visible || !deferred) return null;

  return (
    <div
      role="dialog"
      aria-label="Install Cadieux"
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        bottom: "calc(16px + env(safe-area-inset-bottom))",
        zIndex: 9000,
        maxWidth: 420,
        margin: "0 auto",
        background: "#024628",
        color: "#f5f0e8",
        border: "1px solid rgba(201,169,110,0.28)",
        borderRadius: 6,
        padding: "14px 16px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.02em" }}>
          Install Cadieux
        </div>
        <div style={{ fontSize: 11, color: "rgba(245,240,232,0.65)", marginTop: 2 }}>
          Add to home screen for faster ordering.
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        style={{
          background: "transparent",
          color: "rgba(245,240,232,0.6)",
          border: "none",
          padding: "6px 10px",
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          cursor: "pointer",
          fontFamily: "var(--font-body)",
        }}
      >
        Not now
      </button>
      <button
        type="button"
        onClick={install}
        style={{
          background: "#024628",
          color: "#024628",
          border: "none",
          padding: "8px 14px",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          cursor: "pointer",
          borderRadius: 3,
          fontFamily: "var(--font-body)",
        }}
      >
        Install
      </button>
    </div>
  );
}
