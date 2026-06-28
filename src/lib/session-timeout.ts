"use client";

// Inactivity auto-logout hook.
//
// Tracks pointer/keyboard/scroll/visibility activity, resets an idle
// timer on each interaction, optionally warns ~warnBeforeMs before
// expiry, then calls onTimeout (sign out + redirect). Cross-tab safe
// via a shared "last activity" timestamp in localStorage.
//
// Super admin install (AdminShell): timeoutMs = IDLE.SUPER_ADMIN (30m).

import { useCallback, useEffect, useRef } from "react";

export const IDLE = {
  SUPER_ADMIN: 12 * 60 * 60 * 1000, // 12 hours
  DASHBOARD: 60 * 60 * 1000, // 60 minutes (kept here for parity / future use)
} as const;

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
] as const;

const LS_KEY = "cdx_last_activity";
// Throttle localStorage writes — every mousemove would otherwise pound
// storage and trigger storage events in every other tab.
const WRITE_THROTTLE_MS = 5_000;

export function useIdleLogout({
  timeoutMs,
  onTimeout,
  onWarn,
  warnBeforeMs = 60_000,
  enabled = true,
}: {
  timeoutMs: number;
  onTimeout: () => void | Promise<void>;
  /** Optional: fires ~warnBeforeMs before logout. */
  onWarn?: (msRemaining: number) => void;
  warnBeforeMs?: number;
  /** Skip wiring when false (e.g. before login completes). */
  enabled?: boolean;
}) {
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWrite = useRef(0);
  const firedRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (warnTimer.current) clearTimeout(warnTimer.current);
  }, []);

  const arm = useCallback(() => {
    clearTimers();
    if (warnBeforeMs > 0 && warnBeforeMs < timeoutMs && onWarn) {
      warnTimer.current = setTimeout(
        () => onWarn(warnBeforeMs),
        timeoutMs - warnBeforeMs,
      );
    }
    idleTimer.current = setTimeout(() => {
      if (firedRef.current) return;
      firedRef.current = true;
      void onTimeout();
    }, timeoutMs);
  }, [clearTimers, onTimeout, onWarn, timeoutMs, warnBeforeMs]);

  const onActivity = useCallback(() => {
    const now = Date.now();
    if (now - lastWrite.current > WRITE_THROTTLE_MS) {
      lastWrite.current = now;
      try {
        localStorage.setItem(LS_KEY, String(now));
      } catch {
        /* storage may be unavailable; in-memory timer still works */
      }
    }
    arm();
  }, [arm]);

  useEffect(() => {
    if (!enabled) return;

    // Reset the fire-once latch each time the hook re-arms (e.g. after
    // a login flow re-enables it).
    firedRef.current = false;

    // On mount, respect activity from sibling tabs so a fresh tab can't
    // reset an already-stale session.
    let initialDelay = timeoutMs;
    try {
      const stored = Number(localStorage.getItem(LS_KEY));
      if (Number.isFinite(stored) && stored > 0) {
        const elapsed = Date.now() - stored;
        if (elapsed >= timeoutMs) {
          // Stale timestamp — reset to now so a fresh login always gets
          // a full idle window instead of immediately logging out again.
          // (Mirrors the dashboard's session-timeout behaviour.)
          try {
            localStorage.setItem(LS_KEY, String(Date.now()));
          } catch { /* ignore */ }
          // initialDelay stays at timeoutMs — fall through to set timer
        } else {
          initialDelay = timeoutMs - elapsed;
        }
      }
    } catch {
      /* ignore */
    }

    clearTimers();
    idleTimer.current = setTimeout(() => {
      if (firedRef.current) return;
      firedRef.current = true;
      void onTimeout();
    }, initialDelay);

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true });
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY) arm();
    };
    window.addEventListener("storage", onStorage);
    const onVisible = () => {
      if (document.visibilityState === "visible") onActivity();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearTimers();
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onActivity);
      }
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, timeoutMs]);
}
