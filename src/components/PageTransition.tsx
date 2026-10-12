"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Page transitions — the outgoing page slides left and fades as the incoming
 * one arrives from the right.
 *
 * WHY THE NATIVE API AND NOT A WRAPPER DIV.
 * The obvious implementation is a container around {children} carrying a
 * transform. It cannot be used on this site. A transform establishes a
 * containing block for `position: fixed` descendants, so every fixed element
 * inside a page would re-anchor to the wrapper instead of the viewport —
 * BackLink, the checkout bars, LocationPickerModal, the Select popovers, and
 * anything else in the 40-odd files that use fixed or sticky. The View
 * Transitions API animates SNAPSHOTS in a pseudo-element tree parented to the
 * viewport; the real DOM is never transformed, so nothing re-anchors.
 *
 * It also keeps two other guarantees for free:
 *   - transform and opacity only, on the compositor. The keyframes live in
 *     globals.css (`cdxPageOut` / `cdxPageIn`) and touch nothing else.
 *   - no new dependency. This is browser-native; the bundle cost is this file.
 *
 * AND IT DOES NOT DISTURB THE SCROLL WORK. ScrollReveal's IntersectionObserver
 * fires against the real DOM, which during a view transition is already at its
 * final position and scroll offset — so reveals resolve exactly as they do
 * today. A wrapper that physically slid the page would have held every section
 * outside the viewport for the length of the animation.
 *
 * UNSUPPORTED BROWSERS (Firefox today) and `prefers-reduced-motion: reduce`
 * both fall through to a plain router.push. The reduced-motion check is made
 * in JS as well as CSS deliberately: a CSS-only opt-out would still pay for
 * the snapshot, and the point is to do no work at all.
 */

// Matches the nav drawer's own 450ms / cubic-bezier(0.22,1,0.36,1) family,
// shortened because a whole-viewport move reads faster than a 360px panel.
const COMMIT_BUDGET_MS = 350;

/**
 * Controls that own their click and must never be read as a navigation, even
 * when they sit inside an <a href>.
 *
 * The shop tiles are the case that matters: the whole card is a <Link> to the
 * product page, and Add / Pre-order / + / − are real <button>s inside it. Their
 * handlers call preventDefault + stopPropagation, which is enough to stand
 * next/link down — but NOT this listener, because capture phase runs before
 * React's delegated handlers, so there is nothing for them to stop yet. The
 * result shipped in 5a740f5: pressing Add both added the item AND slid the
 * customer to the product page. Checking the target first is the only place the
 * distinction can be made.
 *
 * Mirrors ROW_INTERACTIVE_SELECTOR in admin/orders — same problem, same answer.
 */
const INTERACTIVE_SELECTOR =
  'button, input, select, textarea, [role="button"]';

type ViewTransition = { finished: Promise<void>; skipTransition: () => void };
type DocumentWithViewTransitions = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => ViewTransition;
};

/**
 * The resolver for the in-flight transition's update callback.
 *
 * Module scope, not a ref, because there are TWO entry points into a
 * navigation on this site and they must share one in-flight slot: the
 * document-level <a href> interceptor below, and the nav drawer, which
 * navigates with router.push from a <button> and would never be seen by a
 * click handler that looks for an anchor.
 */
let pendingCommit: (() => void) | null = null;

function viewTransitionsUsable(): boolean {
  if (typeof document === "undefined") return false;
  const doc = document as DocumentWithViewTransitions;
  if (typeof doc.startViewTransition !== "function") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Run `push` inside a view transition, falling back to calling it directly.
 *
 * THE TIMEOUT IS NOT OPTIONAL. While the update callback's promise is pending
 * the browser holds the last painted frame, so a route that takes a second to
 * arrive would look like a frozen site — worse than no animation. If the new
 * route has not committed within the budget we skip the transition and let the
 * navigation finish unanimated. Resolving WITHOUT skipping would be the wrong
 * repair: old and new snapshots would be the same page, and the user would see
 * identical content slide across itself.
 */
export function navigateWithTransition(push: () => void): void {
  if (pendingCommit || !viewTransitionsUsable()) {
    push();
    return;
  }

  const doc = document as DocumentWithViewTransitions;
  const transition = doc.startViewTransition!(
    () =>
      new Promise<void>((resolve) => {
        pendingCommit = resolve;
        push();
      }),
  );

  const bail = window.setTimeout(() => {
    if (!pendingCommit) return;
    const resolve = pendingCommit;
    pendingCommit = null;
    transition.skipTransition();
    resolve();
  }, COMMIT_BUDGET_MS);

  transition.finished
    .catch(() => {})
    .finally(() => window.clearTimeout(bail));
}

export default function PageTransition() {
  const router = useRouter();
  const pathname = usePathname();

  // Settle the transition once React has committed the new route. An effect is
  // the correct hook for this: it runs after the DOM is updated, which is the
  // exact moment the API wants the callback promise to resolve.
  useEffect(() => {
    if (!pendingCommit) return;
    const resolve = pendingCommit;
    pendingCommit = null;
    resolve();
  }, [pathname]);

  useEffect(() => {
    // CAPTURE PHASE, and that is not a detail — in the bubble phase this
    // handler never fires at all.
    //
    // App Router hydrates the whole document, so React's delegated listeners
    // are attached to `document` itself, during hydration, which is before any
    // effect runs. On a bubble-phase listener React therefore goes first,
    // next/link calls preventDefault, and the `e.defaultPrevented` guard below
    // bails on every single <Link> on the site. Measured: the navigation
    // happened, the transition count stayed at zero.
    //
    // Capture also makes the handoff clean rather than a fight. next/link
    // checks `if (e.defaultPrevented) return` (next/dist/client/link.js:363)
    // AFTER calling the component's own onClick — so preventing default here
    // stands Link down from navigating while still letting a tile's click
    // handler run, and no stopPropagation is needed.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as Element | null;
      // Before anything else: a press on a control is not a navigation.
      if (target?.closest?.(INTERACTIVE_SELECTOR)) return;

      const anchor = target?.closest?.<HTMLAnchorElement>("a");
      if (!anchor || !anchor.getAttribute("href")) return;
      if (anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      // mailto:, tel: and the WhatsApp link are not navigations.
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      if (url.origin !== window.location.origin) return;
      // Admin is a separate product with its own chrome and its own scroll
      // restoration; it is not part of the storefront's motion language.
      if (url.pathname.startsWith("/admin")) return;
      // A bare hash change is a scroll, not a page change.
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return;
      }
      if (!viewTransitionsUsable()) return;

      e.preventDefault();
      navigateWithTransition(() =>
        router.push(url.pathname + url.search + url.hash),
      );
    };

    document.addEventListener("click", onClick, { capture: true });
    return () =>
      document.removeEventListener("click", onClick, { capture: true });
  }, [router]);

  return null;
}
