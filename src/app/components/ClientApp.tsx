"use client";

import { useEffect, useLayoutEffect } from "react";
import PageContent from "@/components/PageContent";

export default function ClientApp() {
  // Intro splash removed. Homepage renders content immediately with no
  // overlay and no perceived wait. The `introActive` prop below is
  // permanently false so PageContent's hero video plays on first paint.
  // LoadingScreen.tsx and /logo-intro.* assets remain on disk so this
  // change is trivially revertible.

  // Disable browser scroll restoration and pin to top on every mount so a
  // mobile refresh always starts at Phase 1, not at wherever the user
  // last scrolled to.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    window.scrollTo(0, 0);
  }, []);

  // Signal to SiteMusic (and any other listener) that the "intro" is
  // done, since it never mounts anymore. SiteMusic on / relies on this
  // event to arm its gesture-unlock listeners. On non-/ routes it
  // unlocks via the pathname check and doesn't need the event; on /
  // its useEffect runs during layout render, so its listener is
  // attached before this dispatch fires from the page component.
  useEffect(() => {
    try {
      window.dispatchEvent(new Event("cadieux:intro-done"));
    } catch {
      /* dispatchEvent virtually never throws — ignore just in case */
    }
  }, []);

  return (
    <div id="main-page">
      <PageContent introActive={false} />
    </div>
  );
}
