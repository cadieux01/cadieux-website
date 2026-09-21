"use client";

// Client-side hook that mirrors app_config.preorder_mode.
//
// Fetches once per page load. It used to refetch on every window focus,
// which meant an alt-tab mid-checkout re-ran an uncached server round-trip
// for a value that changes maybe twice a year. A navigation already remounts
// the hook, and `refresh()` is exported for the one caller that needs to
// re-read on demand. Returns `null` while the first read is in flight so
// callers can render a neutral state instead of guessing normal-mode.

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
  }, [load]);

  return { enabled: state.enabled, loading: state.loading, refresh: () => void load() };
}
