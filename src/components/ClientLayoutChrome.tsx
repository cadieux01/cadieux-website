"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

import {
  type CursorVariant,
  isBakeryVariant,
  resolveCursorVariant,
} from "@/lib/cursor-config";

// Lazy-load both — they ship sizable JS (Lenis ~25KB, custom cursor a few KB
// of GSAP-driven animation). Only fetch on devices that can actually use
// them, i.e. fine pointers (mouse/trackpad). On phones the cursor never
// shows and Lenis just adds jank to native momentum scroll.
const SmoothScroll = dynamic(() => import("@/components/SmoothScroll"), {
  ssr: false,
});
const CustomCursor = dynamic(() => import("@/components/CustomCursor"), {
  ssr: false,
});
const AnimatedCursor = dynamic(() => import("@/components/AnimatedCursor"), {
  ssr: false,
});
const BakeryCursor = dynamic(() => import("@/components/BakeryCursor"), {
  ssr: false,
});

export default function ClientLayoutChrome() {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin") ?? false;

  const [finePointer, setFinePointer] = useState(false);
  // Resolved client-side (reads ?cursor= / localStorage / configured default).
  const [variant, setVariant] = useState<CursorVariant | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: fine)");
    const update = () => setFinePointer(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    setVariant(resolveCursorVariant());
  }, []);

  // Skip SmoothScroll (Lenis) and all cursor variants on admin pages —
  // both add continuous GSAP 60fps tickers that make admin data tables
  // sluggish. The native cursor is restored via the `admin-page` class
  // set by AdminShell.
  if (isAdmin) return null;

  if (!finePointer || variant === null) return null;
  return (
    <>
      <SmoothScroll />
      {variant === "classic" ? (
        <CustomCursor />
      ) : isBakeryVariant(variant) ? (
        <BakeryCursor variant={variant} />
      ) : (
        <AnimatedCursor variant={variant} />
      )}
    </>
  );
}
