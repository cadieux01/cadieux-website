"use client";

// Tick-box selection that survives a trip to a detail page and back.
//
// Sunny, on the orders board: "when I view it and come back, all the selected
// items become deselected. Again I'm doing it from the start."
//
// sessionStorage and NOT the URL on purpose: a bulk selection is a list of
// uuids, which would make the address bar unusable and would travel to anyone
// the link is sent to. Selection is per-session working state, not part of
// what a /admin/orders link means.
//
// WHY THIS IS A HOOK AND NOT TWO EXPORTED FUNCTIONS. The hard part is not
// reading and writing — it is the ORDER the two effects run in, and the fact
// that neither may run during the first render. Handing a board the two
// halves and trusting it to wire them up correctly is handing it the
// hydration bug and the clobber bug to rediscover. The key is a parameter so
// two boards never share a bucket.

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

function readStored(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

/**
 * `[selected, setSelected]`, mirrored into sessionStorage under `key`.
 *
 * Behaves exactly like `useState<Set<string>>(new Set())` — including
 * starting EMPTY on the first render, which is the point.
 */
export function useStoredSelection(
  key: string,
): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Restoration runs AFTER hydration, never in the useState initialiser: the
  // server has no sessionStorage, so it always renders zero selected and
  // therefore no bulk toolbar. Seeding the first client render from storage
  // would make the client emit a node the server HTML does not have, which
  // React treats as a hydration mismatch. Restoring here means both sides
  // agree on the first render and the selection appears on the commit
  // straight after.
  const restored = useRef(false);
  useEffect(() => {
    restored.current = true;
    const stored = readStored(key);
    if (stored.size > 0) setSelected(stored);
  }, [key]);

  // Keep the mirror in step with every change, including the ones that empty
  // it (Clear, and the bulk handlers). Gated on the restore having run: this
  // effect is declared second, so on mount it would otherwise write the empty
  // initial state over the stored ids before the effect above has read them.
  useEffect(() => {
    if (!restored.current) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(Array.from(selected)));
    } catch {
      // Private-mode / quota failures are not worth surfacing: the selection
      // still works for this page view, it just won't survive the round trip.
    }
  }, [key, selected]);

  return [selected, setSelected];
}
