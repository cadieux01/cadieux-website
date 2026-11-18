"use client";

// Shared signed-in profile, exposed to every /mkt client component.
// The /mkt/layout.tsx server component reads the session and hands
// the profile down; every page below can read it without another
// round-trip via useMktProfile().
//
// Kept intentionally thin — only the fields rendered in the chrome
// or needed to drive per-role UI. Anything else should go through
// a real query.

import { createContext, useContext, type ReactNode } from "react";

import type { MktProfile } from "@/lib/mkt-auth";

const Ctx = createContext<MktProfile | null>(null);

export function MktProfileProvider({
  profile,
  children,
}: {
  profile: MktProfile;
  children: ReactNode;
}) {
  return <Ctx.Provider value={profile}>{children}</Ctx.Provider>;
}

export function useMktProfile(): MktProfile {
  const p = useContext(Ctx);
  if (!p) {
    // The provider wraps every /mkt page except /mkt/login (whose
    // layout short-circuits). Any client component calling this
    // outside the provider is a bug.
    throw new Error(
      "useMktProfile called outside MktProfileProvider — only /mkt pages (not /mkt/login) wrap the provider",
    );
  }
  return p;
}
