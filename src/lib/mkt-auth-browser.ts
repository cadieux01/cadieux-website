// Browser-only Supabase client for /mkt. Split out from
// src/lib/mkt-auth.ts so a client component (the /mkt/login form,
// MktShell's sign-out button) can import this without dragging in
// next/headers — which is server-only and makes the whole file
// unbuildable in a client bundle.
//
// The server lane lives in src/lib/mkt-auth.ts and uses
// `import "server-only"` so a future client import of that file fails
// at build time rather than silently shipping the server helpers.

import { createBrowserClient } from "@supabase/ssr";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!URL || !ANON) {
  throw new Error(
    "mkt-auth-browser requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
}

/** Supabase client scoped to the logistics schema. Hydrated from the
 *  browser's cookies — the server lane's cookie writes make the
 *  session available here on the same request cycle. */
export function mktBrowserClient() {
  return createBrowserClient(URL!, ANON!, {
    db: { schema: "logistics" },
  });
}
