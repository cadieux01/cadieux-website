// POST /api/mkt/uploads/signed-url
//
// Mints a signed upload URL for a /mkt bucket (campaign-assets today;
// a shortlist of allowed bucket ids below so a hostile payload can't
// have the service role hand out a signed URL for anything else).
//
// Browser → signed URL → direct PUT to Supabase Storage, same pattern
// as /api/admin/uploads/signed-url. The difference: this route is
// authenticated via the Supabase Auth cookie (the /mkt lane), not the
// admin HMAC bearer. Any caller whose profile.status = 'active' can
// mint a token; the campaign-level authorisation happens when the
// resulting storage_path is attached to a campaign_assets row, where
// the campaign_assets_insert RLS policy gates on
// my_led_campaign_ids().

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { mktServerClient } from "@/lib/mkt-auth";

const ALLOWED_BUCKETS = new Set(["campaign-assets"]);
const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
// Max size mirrored from the bucket row (52,428,800 B binary). The
// bucket row is the real enforcement — this is the fast-fail courtesy.
const MAX_BYTES = 52_428_800;

export async function POST(req: NextRequest) {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Require profile.status = 'active'. Only one SELECT, no extra
  // round-trip beyond what readMktSession would do anyway.
  const { data: me } = await sb
    .from("profiles")
    .select("status")
    .eq("id", userRes.user.id)
    .maybeSingle();
  if (!me || me.status !== "active") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { bucket?: unknown; prefix?: unknown; mime?: unknown; size?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const bucket = typeof body.bucket === "string" ? body.bucket : "";
  if (!ALLOWED_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: `Unknown bucket "${bucket}"` }, { status: 400 });
  }
  const mime = typeof body.mime === "string" ? body.mime : "";
  if (!ALLOWED_MIMES.has(mime)) {
    return NextResponse.json(
      { error: `Unsupported mime "${mime}". Allowed: ${Array.from(ALLOWED_MIMES).join(", ")}` },
      { status: 400 },
    );
  }
  const size = typeof body.size === "number" ? body.size : NaN;
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File must be 1..${MAX_BYTES} bytes, got ${String(body.size)}` },
      { status: 400 },
    );
  }

  const prefix =
    typeof body.prefix === "string"
      ? body.prefix
          .replace(/[^a-zA-Z0-9/_-]/g, "")
          .replace(/^\/+|\/+$/g, "")
          .slice(0, 64)
      : "";

  const ext = EXT_BY_MIME[mime] ?? "bin";
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const path = prefix ? `${prefix}/${filename}` : filename;

  // Service-role client for the storage API — the user's JWT doesn't
  // have the privilege to mint signed upload URLs; createSignedUploadUrl
  // is an admin call. The service role is NEVER exposed to the caller;
  // we only return the signed-url token to them, which is scoped to a
  // single path and is single-shot.
  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: signed, error } = await svc.storage
    .from(bucket)
    .createSignedUploadUrl(path);
  if (error || !signed?.signedUrl || !signed?.token) {
    console.error("[mkt/uploads/signed-url]", error?.message);
    return NextResponse.json(
      { error: error?.message ?? "Could not create upload URL" },
      { status: 500 },
    );
  }

  // campaign-assets is PRIVATE — getPublicUrl returns a URL that will
  // NOT work for a browser without a signed download URL. Still
  // return the path so the client can round-trip to a signed read
  // URL via /api/mkt/campaigns/[id]/assets later.
  return NextResponse.json({
    bucket,
    path,
    token: signed.token,
    signedUrl: signed.signedUrl,
    // publicUrl is null for private buckets — do not pretend otherwise.
    publicUrl: null,
  });
}
