"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

// The "← Cadieux" chrome that sits at the top-left of every non-home page.
//
// It is position:fixed with no background, so anything that scrolls through
// viewport rows 24–48 gets painted over: on /shop the intro paragraph read
// "artificia CADIEUX vatives". This was duplicated byte-for-byte across 20
// pages, which is why one missing background became twenty bugs.
//
// Behaviour is the standard hiding-header pattern: visible at the top, fades
// out once you scroll down past the fold of the link itself, and fades back in
// the moment you scroll up — so the back affordance is always one flick away
// without a permanent chip taking up phone height.
//
// Scrolling back up re-exposes the original overlap, so past HIDE_BELOW_Y the
// link gets a solid backdrop (a ::before pill, see globals.css). At rest it is
// absent, so the top of every page looks exactly as it always has.

/** Above this scroll position the link is always shown; it can only hide below it. */
const HIDE_BELOW_Y = 40;
/**
 * Minimum scroll delta before we react. Swallows trackpad and finger jitter
 * (and iOS rubber-banding) so the link cannot strobe. Deltas under this do NOT
 * update the reference position, so a slow deliberate scroll still accumulates
 * past the threshold and triggers.
 */
const JITTER_PX = 6;

type Props = {
  href: string;
  /** Label after the arrow, e.g. "Cadieux", "Shop", "All Stories". */
  children: ReactNode;
  /**
   * Foundation Green (default) reads on the ash canvas; the four pages that
   * open on a dark or image-led hero use Endurance Blue instead.
   */
  color?: string;
  /**
   * Three pages predate the safe-area insets and use flat 24/20 offsets.
   * Kept as-is so this refactor shifts nothing; see the audit note in the PR.
   */
  safeArea?: boolean;
  /**
   * Fill of the scrolled-state pill. Must be the page's own canvas colour and
   * fully opaque — see the note on `.cdx-backlink::before` in globals.css.
   * 18 of 20 pages are the ash canvas; only /subscription and behind-cadieux
   * differ.
   */
  backdrop?: string;
};

export default function BackLink({
  href,
  children,
  color = "#024628",
  safeArea = true,
  backdrop = "#C0C8CE",
}: Props) {
  const [hidden, setHidden] = useState(false);
  // Separate from `hidden`: the pill is tied to being past the fold, not to
  // scroll direction, so it does not pop in and out as the link fades.
  const [scrolled, setScrolled] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;
    let queued = false;

    const evaluate = () => {
      queued = false;
      const y = window.scrollY;

      if (y <= HIDE_BELOW_Y) {
        lastY.current = y;
        setScrolled(false);
        setHidden(false);
        return;
      }

      setScrolled(true);
      const dy = y - lastY.current;
      if (Math.abs(dy) < JITTER_PX) return;
      lastY.current = y;
      setHidden(dy > 0);
    };

    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(evaluate);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    // Restored scroll position on a back-navigation can already be past the fold.
    evaluate();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <Link
      href={href}
      className="cdx-backlink"
      // A transparent, invisible link must not keep eating taps in the corner,
      // nor should a keyboard user land on something they cannot see.
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      data-scrolled={scrolled ? "true" : undefined}
      style={{
        // Consumed by the ::before pill. The pill is drawn by CSS so the
        // anchor's own box is untouched and nothing shifts when it appears.
        "--cdx-backlink-backdrop": backdrop,
        position: "fixed",
        top: safeArea ? "calc(24px + env(safe-area-inset-top))" : 24,
        left: safeArea ? "calc(20px + env(safe-area-inset-left))" : 20,
        zIndex: 101,
        fontFamily: "var(--font-body)",
        fontSize: 14,
        fontWeight: 500,
        letterSpacing: "0.35em",
        textTransform: "uppercase",
        color,
        textDecoration: "none",
        display: "flex",
        alignItems: "center",
        gap: 8,
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? "none" : "auto",
      } as CSSProperties}
    >
      <span style={{ fontSize: 16 }}>←</span> {children}
    </Link>
  );
}
