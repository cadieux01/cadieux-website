"use client";

import { useLayoutEffect, useState } from "react";
import LoadingScreen from "./LoadingScreen";
import PageContent from "@/components/PageContent";

export default function ClientApp() {
  const [introDone, setIntroDone] = useState(false);

  // Disable browser scroll restoration and pin to top on every mount so a
  // mobile refresh always starts at the loading intro / Phase 1, not at
  // wherever the user last scrolled to.
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    window.scrollTo(0, 0);
  }, []);

  // PageContent renders from the very first (server) paint so its hero
  // heading is in the initial HTML and becomes a stable, text-based LCP
  // element. Previously it was gated behind `introDone`, so during the 4-6s
  // intro the only painted thing was the intro <video> (not a reliable LCP
  // candidate), and the real hero mounted — then the intro overlay was
  // removed — after Lighthouse's measurement window: PageSpeed reported
  // NO_LCP and couldn't measure LCP/TBT.
  //
  // The intro <video> overlay (LoadingScreen, position:fixed z-1000) still
  // sits on top and plays exactly as before. We pass `introActive` so
  // PageContent holds its hero video's playback until the intro finishes —
  // preserving the original optimization of not decoding Phase 1's video
  // invisibly under the LoadingScreen.
  return (
    <div id="main-page">
      <PageContent introActive={!introDone} />
      {!introDone && <LoadingScreen onComplete={() => setIntroDone(true)} />}
    </div>
  );
}
