// GET  /api/mkt/campaigns/[id]/assets  → list assets + signed read URLs
// POST /api/mkt/campaigns/[id]/assets  → attach a just-uploaded storage
//                                         object to this campaign
//
// The upload flow:
//   1. browser POST /api/mkt/uploads/signed-url → { path, token }
//   2. browser PUT to the signed URL (bytes go straight to Supabase)
//   3. browser POST /api/mkt/campaigns/[id]/assets with { path, kind,
//      caption }  → this route writes the campaign_assets row
//
// The RLS insert policy on campaign_assets gates on
// my_led_campaign_ids(), so a non-admin, non-owner, non-leader can't
// attach to a campaign they only have SELECT access to.
//
// On GET, we additionally mint a short-lived signed READ URL per
// asset so the UI can render thumbnails. Bucket is private, so
// publicUrl is useless.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { mktServerClient } from "@/lib/mkt-auth";

const KINDS = new Set(["content", "proof", "photo"]);
const READ_TTL_SECONDS = 3600; // 1 hour; images are re-fetched on refresh

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: rows, error } = await sb
    .from("campaign_assets")
    .select("id, campaign_id, kind, storage_path, caption, uploaded_by, created_at")
    .eq("campaign_id", params.id)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Bucket is private — mint signed READ URLs server-side so the UI
  // can render thumbnails without a client-side service-role.
  const svc = serviceClient();
  const assets = await Promise.all(
    (rows ?? []).map(async (r) => {
      const { data: signed } = await svc.storage
        .from("campaign-assets")
        .createSignedUrl(r.storage_path, READ_TTL_SECONDS);
      return { ...r, signed_url: signed?.signedUrl ?? null };
    }),
  );
  return NextResponse.json({ assets });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const storage_path = typeof body?.storage_path === "string" ? body.storage_path.trim() : "";
  const kind = typeof body?.kind === "string" ? body.kind : "";
  const caption = typeof body?.caption === "string" ? body.caption : null;
  if (!storage_path) {
    return NextResponse.json({ error: "storage_path is required" }, { status: 400 });
  }
  if (!KINDS.has(kind)) {
    return NextResponse.json({ error: "kind must be content|proof|photo" }, { status: 400 });
  }

  const { data, error } = await sb
    .from("campaign_assets")
    .insert({
      campaign_id: params.id,
      kind,
      storage_path,
      caption,
      uploaded_by: userRes.user.id,
    })
    .select("id, campaign_id, kind, storage_path, caption, uploaded_by, created_at")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ asset: data });
}
