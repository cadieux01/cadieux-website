// SERVER-ONLY Supabase Auth plumbing for /mkt.
//
// The admin surface (/admin/*) keeps its existing HMAC session (see
// src/lib/admin-session.ts + src/lib/admin-auth.ts). This file is a
// SEPARATE lane that uses Supabase's real user sessions — auth.users
// + auth.uid() — so that /mkt actions attribute to the human doing
// them and RLS can key on who the caller is.
//
// Why the `import "server-only"`:
//   next/headers is unresolvable in a client bundle, and the first
//   phase of this feature co-located `mktBrowserClient()` here. The
//   first client import (the sign-in form) failed `next build` with
//   a cryptic server-components error. The browser-only lane now
//   lives in src/lib/mkt-auth-browser.ts, and this guardrail makes
//   the next regression fail loudly at build time instead of at
//   first bundle.
//
// Server helpers:
//
//   mktServerClient()   — for server components, route handlers and
//                         server actions. Reads + writes the Supabase
//                         cookies via next/headers. Use this on every
//                         /api/mkt/* route and inside any `async`
//                         server component under /mkt.
//
//   readMktSession()    — resolves the server-side session + the
//                         caller's logistics.profiles row, returning
//                         a discriminated-union result so the layout
//                         can decide what to render.
//
//   requireMktSession() — thin wrapper that redirects on anything
//                         other than { kind: 'ok' }, and additionally
//                         redirects non-admin callers when
//                         { requireAdmin: true }.

import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!URL || !ANON) {
  // Module-scope error so a build-time env miss fails loudly here
  // rather than with a cryptic 500 on first sign-in.
  throw new Error(
    "mkt-auth requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
}

export type MktProfile = {
  id: string;
  role: string;
  status: string;
  full_name: string | null;
  email: string | null;
};

/** Server-side Supabase client. Carries the signed-in user's cookies,
 *  so every query it makes runs under RLS as that user. */
export function mktServerClient() {
  const cookieStore = cookies();
  return createServerClient(URL!, ANON!, {
    cookies: {
      // next/headers in Next 14 app router: `getAll` + `setAll`
      // signatures per @supabase/ssr docs. On a read-only server
      // component (rendering the page), set* is a no-op; Next will
      // forward Set-Cookie headers emitted during navigation.
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll is called from a Server Component in some paths;
          // Next refuses to mutate cookies in that context. The
          // middleware (not added here — the SSR helpers tolerate its
          // absence) or a route handler will refresh the cookie on
          // the next request. See @supabase/ssr README.
        }
      },
    },
    db: { schema: "logistics" },
  });
}

/** Read the signed-in user + their logistics.profiles row. Returns
 *  null when there is no session, 'inactive' when the row exists but
 *  status is not 'active', and 'ok' when the caller is allowed through.
 *
 *  Separated from requireMktSession() so a page that wants to render
 *  a custom "you were deactivated" screen can inspect the result,
 *  rather than being bounced through a login redirect loop.
 */
export async function readMktSession(): Promise<
  | { kind: "none" }
  | { kind: "no-profile"; userId: string; email: string | null }
  | { kind: "inactive"; profile: MktProfile }
  | { kind: "ok"; profile: MktProfile }
> {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  const user = userRes?.user ?? null;
  if (!user) return { kind: "none" };

  // Client is already pinned to the logistics schema, so this is just
  // .from("profiles").
  const { data, error } = await sb
    .from("profiles")
    .select("id, role, status, full_name, email")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    // The profile fetch failed via RLS — treat as "no profile" rather
    // than "ok", which would be a privilege escalation. Signed in but
    // not known to logistics means the operator has an auth.users row
    // without a matching profiles row (brief says 14 of 22 are
    // confirmed with matching profiles; the other 8 would land here).
    return { kind: "no-profile", userId: user.id, email: user.email ?? null };
  }
  if (!data) return { kind: "no-profile", userId: user.id, email: user.email ?? null };
  const profile: MktProfile = {
    id: data.id as string,
    role: data.role as string,
    status: data.status as string,
    full_name: (data.full_name as string | null) ?? null,
    email: (data.email as string | null) ?? user.email ?? null,
  };
  if (profile.status !== "active") return { kind: "inactive", profile };
  return { kind: "ok", profile };
}

/** The common case: a /mkt page that requires an active session.
 *  Redirects to /mkt/login when there's no session; returns the
 *  profile otherwise. Callers that need to render a custom message
 *  for 'inactive' should use readMktSession() instead.
 */
export async function requireMktSession(options?: {
  /** If set, additionally require profile.role === 'admin'. Non-admin
   *  callers are redirected to /mkt with ?denied=admin so the page can
   *  surface a visible message. */
  requireAdmin?: boolean;
}): Promise<MktProfile> {
  const state = await readMktSession();
  if (state.kind === "none") redirect("/mkt/login");
  if (state.kind === "no-profile")
    redirect("/mkt/login?denied=no-profile");
  if (state.kind === "inactive")
    redirect(`/mkt/login?denied=${encodeURIComponent(state.profile.status)}`);
  if (options?.requireAdmin && state.profile.role !== "admin") {
    redirect("/mkt?denied=admin");
  }
  return state.profile;
}
