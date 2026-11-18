// /mkt layout — the SERVER-SIDE gate for the marketing workspace.
//
// /mkt uses Supabase Auth, not the admin PasswordGate. This layout
// reads the session via @supabase/ssr, resolves the caller's
// logistics.profiles row, and redirects to /mkt/login unless
// profile.status = 'active'. /admin keeps its own PasswordGate; the
// two surfaces are two credential systems on purpose.
//
// WHY /mkt/login IS NOT A CHILD OF THIS LAYOUT.
//
// The first version of this file did:
//
//   const pathname = headers().get("x-invoke-path") ?? ...;
//   if (pathname.startsWith("/mkt/login")) return <>{children}</>;
//
// so the gate could short-circuit on the login page. That failed in
// production because the headers it read (`x-invoke-path`,
// `x-pathname`, `next-url`) are NOT reliably populated by Next 14 on
// Vercel — they are internal, best-effort, and absent under the
// standard request flow. When the sniff returned "", the layout fell
// through to the session check, the session was absent, and the
// redirect sent /mkt/login → /mkt/login. Safari surfaced it as "Load
// cannot follow more than 20 redirections"; prod was down on /mkt.
//
// The fix is structural, not another sniff. /mkt/login lives at
// src/app/(mkt-public)/mkt/login/page.tsx — a Next.js route group
// (parens have no URL effect) that resolves to URL /mkt/login WITHOUT
// inheriting this layout. So the login route is literally outside the
// gate's cascade. This file no longer needs to know anything about
// its own request path.

import type { ReactNode } from "react";

import { MktProfileProvider } from "@/components/mkt/MktProfileContext";
import { readMktSession } from "@/lib/mkt-auth";
import { redirect } from "next/navigation";

export default async function MktLayout({ children }: { children: ReactNode }) {
  const state = await readMktSession();
  if (state.kind === "none") redirect("/mkt/login");
  if (state.kind === "no-profile") redirect("/mkt/login?denied=no-profile");
  if (state.kind === "inactive")
    redirect(`/mkt/login?denied=${encodeURIComponent(state.profile.status)}`);

  return (
    <MktProfileProvider profile={state.profile}>{children}</MktProfileProvider>
  );
}
