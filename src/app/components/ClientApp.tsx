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

  // Mount PageContent only after the intro finishes so Phase 1's video
  // doesn't decode + play invisibly under the LoadingScreen for 4s.
  return (
    <div id="main-page">
      {!introDone && <LoadingScreen onComplete={() => setIntroDone(true)} />}
      {introDone && <PageContent />}
    </div>
  );
}
