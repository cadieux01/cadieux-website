"use client";

import { useEffect } from "react";

// Premium artisan-loaf cursor (CSS-only).
//
// The cursor image swap is pure CSS — a single class on <html> drives native
// `cursor: url()` rules (see globals.css), so it costs zero per-frame JS and
// never touches scroll/click precision. Desktop-only and reduced-motion gating
// live in the CSS media query; this component only toggles the class on <html>.
export default function BreadCursor() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("bread-cursor");
    return () => root.classList.remove("bread-cursor");
  }, []);

  return null;
}
