"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Back-navigation state for the admin boards.
//
// Both /admin/orders and /admin/subscriptions are "narrow the list, open a
// row, come back" surfaces. Without this, coming back resets the filter, the
// search box, the day and the scroll position, so the operator re-narrows on
// every single row. The board state therefore rides the query string, and the
// scroll offset rides sessionStorage.
//
// Extracted rather than copied: the two effects below each encode a fix for a
// failure that took a live session to find, and a second copy would only
// inherit the first version of them.

/**
 * Mirror board state onto the query string.
 *
 * `replace`, not `push`: narrowing a filter is not a navigation, and pushing
 * would make Back step backwards through every keystroke of date-picking
 * instead of leaving the board.
 *
 * The identity check is not an optimisation — `router.replace` on the URL we
 * are already at still re-renders, which re-runs this effect, which is a loop.
 *
 * @param path  the board's own pathname, e.g. `/admin/orders`
 * @param qs    already-serialised query string, no leading `?`. Callers omit
 *              default values so a plain board link stays clean.
 */
export function useUrlWriteback(path: string, qs: string): void {
  const router = useRouter();
  useEffect(() => {
    const current =
      typeof window === "undefined"
        ? ""
        : window.location.search.replace(/^\?/, "");
    if (qs === current) return;
    router.replace(qs ? `${path}?${qs}` : path, { scroll: false });
  }, [path, qs, router]);
}

/**
 * Stash the current scroll offset immediately before navigating to a detail
 * page. Swallows quota/private-mode failures: losing scroll restoration is
 * not a reason to not open the row.
 */
export function stashScrollY(key: string): void {
  try {
    sessionStorage.setItem(key, String(window.scrollY));
  } catch {
    // Private-mode / quota — non-fatal, we just land at the top on the
    // way back.
  }
}

/**
 * Restore a stashed scroll offset once the list has rendered, then clear it.
 *
 * Because the entry is only ever written by `stashScrollY` on a row click, a
 * fresh visit or a hard reload finds nothing and starts at the top — there is
 * no accidental jump to a stale row.
 *
 * A TIMER, not requestAnimationFrame: rAF does not fire while the tab is
 * hidden, and these boards are used exactly that way — open the row, switch to
 * WhatsApp or a call, come back. Under rAF the restore simply never ran.
 *
 * One attempt is also not enough. The rows are in the DOM but the document may
 * not be laid out yet, so scrollTo clamps against a short page and lands
 * short. Retry until it sticks, then give up rather than fight an operator who
 * has scrolled somewhere themselves.
 *
 * @param ready  false while the list is still loading; the restore waits.
 */
export function useScrollRestore(key: string, ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    if (typeof window === "undefined") return;
    const raw = sessionStorage.getItem(key);
    if (raw === null) return;
    sessionStorage.removeItem(key);
    const y = Number(raw);
    if (!Number.isFinite(y) || y <= 0) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      window.scrollTo(0, y);
      if (window.scrollY < y && tries++ < 10) timer = setTimeout(settle, 32);
    };
    settle();
    return () => clearTimeout(timer);
  }, [key, ready]);
}
