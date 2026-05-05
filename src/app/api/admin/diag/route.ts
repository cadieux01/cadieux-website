import { NextRequest, NextResponse } from "next/server";

// TEMPORARY diagnostic. Reports env-var presence and lengths only — never
// the actual values. Gated by a random one-time key. Delete after use.
const MAGIC = "44bd884e-39f8-46a8-a2d3-aaca0761b4c1";

export async function GET(req: NextRequest) {
  if (req.headers.get("x-diag-key") !== MAGIC) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sentToken = req.headers.get("x-admin-token") ?? "";
  const envToken = process.env.ADMIN_TOKEN ?? "";

  return NextResponse.json({
    runtime: process.env.NEXT_RUNTIME ?? null,
    vercel_env: process.env.VERCEL_ENV ?? null,
    has_admin_token: Boolean(process.env.ADMIN_TOKEN),
    admin_token_len: envToken.length,
    admin_token_first: envToken ? envToken.slice(0, 1) : null,
    admin_token_last: envToken ? envToken.slice(-1) : null,
    sent_token_len: sentToken.length,
    equal: sentToken === envToken,
    has_supabase_url: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabase_url_host: process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
      : null,
    has_service_role: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    service_role_len: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").length,
  });
}
