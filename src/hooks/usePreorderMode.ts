"use client";

// Client-side hook that mirrors app_config.preorder_mode.
//
// Fetches on mount and on window focus, so a stale toggle never persists
// after an admin flip. No indefinite caching — a redundant network call
// (once per focus) is cheaper than showing a lying UI. Returns `null` while
// the first read is in flight so callers can render a neutral state instead
// of guessing normal-mode.

import { useCallback, useEffect, useState } from "react";

type State = { enabled: boolean | null; loading: boolean };

export function usePreorderMode(): {
  enabled: boolean | null;
  loading: boolean;
  refresh: () => void;
} {
  const [state, setState] = useState<State>({ enabled: null, loading: true });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/preorder-mode", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { enabled?: boolean };
      setState({ enabled: !!json.enabled, loading: false });
    } catch (err) {
      console.warn("[usePreorderMode] fetch failed:", err);
      // Fail safe = normal mode (false), NOT null — a network blip must
      // not lock the store into "pre-order forever" from the customer's POV.
      setState({ enabled: false, loading: false });
    }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => {
      void load();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  return { enabled: state.enabled, loading: state.loading, refresh: () => void load() };
}
