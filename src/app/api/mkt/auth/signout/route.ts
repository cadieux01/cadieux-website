// POST /api/mkt/auth/signout
//
// Ends the Supabase Auth session for /mkt. Returns 204 on success;
// callers follow up with a client-side navigation to /mkt/login. The
// route handler is the right place for this (rather than a server
// action) because `createServerClient` can mutate cookies here —
// it cannot from a plain server component.

import { NextResponse } from "next/server";
import { mktServerClient } from "@/lib/mkt-auth";

export async function POST() {
  const sb = mktServerClient();
  const { error } = await sb.auth.signOut();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
