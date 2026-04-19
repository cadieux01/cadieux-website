"use client";

import { useState, useEffect, type ReactNode } from "react";

// Returns null on the server (and on first hydration pass).
// After mount, renders children client-side only.
// This avoids dynamic({ ssr: false }) which triggers BailoutToCSR loops in Next.js 14.
export default function ClientOnly({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return <>{children}</>;
}
