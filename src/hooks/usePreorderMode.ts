"use client";

// Client-side hook that mirrors app_config.preorder_mode.
//
// Fetches through the shared client cache, so the two mounts that /checkout
// creates (checkout page + cart summary) collapse into one request — and a
// remount within the TTL costs nothing at all. Returns `null` while the first
// read is in flight so callers can render a neutral state instead of guessing
// normal-mode.
//
// NO REFETCH ON WINDOW FOCUS. It used to re-read on every focus event, so an
// alt-tab mid-checkout — returning from the SMS app to copy an OTP, say —
// re-ran a server round-trip that was ~1 s before it was cached, for a value
// that changes maybe twice a year. A navigation already remounts the hook, and
// `refresh()` is exported for the one caller that needs to re-read on demand.
// Dropping it is safe because this hook is presentation only: the server
// refuses a pre-order-mode violation independently on every order and
// subscription path, so a client that is seconds stale shows the wrong banner,
// it does not open a hole.

import { useCallback, useEffect, useState } from "react";

import { cachedJson } from "@/lib/client-json-cache";

/** Short enough that an admin flip surfaces on the next navigation, long
 *  enough to cover a single checkout session's mounts. */
const TTL_MS = 30_000;

type State = { enabled: boolean | null; loading: boolean };

export function usePreorderMode(): {
  enabled: boolean | null;
  loading: boolean;
  refresh: () => void;
} {
  const [state, setState] = useState<State>({ enabled: null, loading: true });

  const load = useCallback(async (force = false) => {
    try {
      const json = await cachedJson<{ enabled?: boolean }>(
        "/api/preorder-mode",
        TTL_MS,
        force,
      );
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

  // `refresh` bypasses the TTL — it exists for callers that have a reason to
  // believe the value just changed, and honouring the cache there would make
  // an explicit refresh a no-op.
  return {
    enabled: state.enabled,
    loading: state.loading,
    refresh: () => void load(true),
  };
}
