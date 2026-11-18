// /mkt layout — now the SERVER-SIDE gate for the marketing workspace.
//
// Earlier phases gated /mkt via a client-side PasswordGate inside
// MktShell (shared with /admin). That gate accepted a generic admin
// password, which meant `auth.uid()` was null on every /mkt action and
// nothing could be attributed to the person doing it.
//
// This layout now:
//   1. Reads the Supabase Auth session via @supabase/ssr.
//   2. Looks up the caller's logistics.profiles row.
//   3. Redirects to /mkt/login unless profile.status = 'active'.
//   4. Renders the page's children with a shared ProfileProvider so
//      every /mkt client component can read the signed-in identity
//      without re-fetching.
//
// The /mkt/login route is a direct child of this layout, so it runs
// through the gate too — but readMktSession() is read-only, and the
// login page skips the shared chrome. The gate redirects there when
// the session is missing; the login page itself never needs it.

import type { ReactNode } from "react";

import { MktProfileProvider } from "@/components/mkt/MktProfileContext";
import { readMktSession } from "@/lib/mkt-auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export default async function MktLayout({ children }: { children: ReactNode }) {
  // The login page is the escape hatch: if we redirected it into
  // itself whenever the session was absent we'd loop. next/headers
  // exposes the request path so we can short-circuit here.
  const h = headers();
  const pathname =
    h.get("x-invoke-path") ??
    h.get("x-pathname") ??
    h.get("next-url") ??
    "";

  if (pathname.startsWith("/mkt/login")) {
    return <>{children}</>;
  }

  const state = await readMktSession();
  if (state.kind === "none") redirect("/mkt/login");
  if (state.kind === "no-profile") redirect("/mkt/login?denied=no-profile");
  if (state.kind === "inactive")
    redirect(`/mkt/login?denied=${encodeURIComponent(state.profile.status)}`);

  return (
    <MktProfileProvider profile={state.profile}>{children}</MktProfileProvider>
  );
}
