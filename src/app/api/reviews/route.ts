import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { reviewRateLimit, getClientIP } from "@/lib/ratelimit";
import { getVerifiedPhone, normalizePhone } from "@/lib/phone-cookie";
import { publicDisplayName } from "@/lib/review-display";
import { isAdmin } from "@/lib/admin-auth";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function GET(req: NextRequest) {
  const product = req.nextUrl.searchParams.get("product");

  // Admin callers (valid x-admin session/bearer) get the full moderation
  // view: soft-deleted rows are INCLUDED (so a row deleted by mistake can
  // be restored) and the raw author_name is returned (so edits round-trip).
  // Public callers (web + mobile app) get the existing filtered payload.
  const admin = isAdmin(req);

  // Verified phone identifies the caller for the is_owner flag. Not
  // required — anonymous browsers still get the full public list.
  const verified = getVerifiedPhone(req);
  const verifiedPhone = verified ? normalizePhone(verified.phone) : null;

  let q = supabaseAdmin
    .from("reviews")
    .select(
      "id, product_slug, author_name, rating, body, likes_count, created_at, edited_at, is_edited, is_deleted, deleted_at, customer_phone"
    )
    .order("created_at", { ascending: false });
  // Public never sees soft-deleted reviews; admins see everything.
  if (!admin) q = q.eq("is_deleted", false);
  if (product) q = q.eq("product_slug", product);
  const { data: reviews, error } = await q;
  if (error) {
    console.error("reviews list failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (reviews ?? []).map((r) => r.id);
  let replies: { id: string; review_id: string; author_name: string; is_admin: boolean; body: string; likes_count: number; created_at: string; edited_at: string | null; is_edited: boolean; is_deleted: boolean; deleted_at: string | null }[] = [];
  if (ids.length) {
    let rq = supabaseAdmin
      .from("review_replies")
      .select("id, review_id, author_name, is_admin, body, likes_count, created_at, edited_at, is_edited, is_deleted, deleted_at")
      .in("review_id", ids)
      .order("created_at", { ascending: true });
    // Hide soft-deleted replies from the public web + mobile app so an
    // admin delete actually removes them. Admins keep seeing them (with a
    // deleted badge) so they can restore.
    if (!admin) rq = rq.eq("is_deleted", false);
    const { data: rdata, error: rerr } = await rq;
    if (rerr) {
      console.error("replies fetch failed:", rerr);
      return NextResponse.json({ error: rerr.message }, { status: 500 });
    }
    replies = rdata ?? [];
  }

  const byReview = new Map<string, typeof replies>();
  for (const r of replies) {
    const arr = byReview.get(r.review_id) ?? [];
    arr.push(r);
    byReview.set(r.review_id, arr);
  }

  if (admin) {
    // Admin moderation payload: raw author_name + moderation flags exposed
    // so the editor can pre-fill and round-trip. customer_phone is STILL
    // dropped — moderation never needs it. Never cached.
    const out = (reviews ?? []).map((r) => {
      const { customer_phone: _omit, ...rest } = r;
      void _omit;
      return { ...rest, is_owner: false, replies: byReview.get(r.id) ?? [] };
    });
    return NextResponse.json(
      { reviews: out },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // Shape the public payload: replace author_name with first-name-only,
  // compute is_owner, and DROP customer_phone so it never leaves the
  // server. Admin-side tooling reads the raw row directly via Supabase.
  const out = (reviews ?? []).map((r) => {
    const isOwner =
      !!verifiedPhone &&
      !!r.customer_phone &&
      normalizePhone(r.customer_phone) === verifiedPhone;
    const { customer_phone: _omit, ...rest } = r;
    void _omit;
    return {
      ...rest,
      author_name: publicDisplayName(r.author_name),
      is_owner: isOwner,
      replies: byReview.get(r.id) ?? [],
    };
  });
  return NextResponse.json(
    { reviews: out },
    {
      headers: {
        // Private (browser-only) cache: the payload carries a per-user
        // `is_owner` flag derived from the caller's verified-phone cookie,
        // so it must NEVER be shared by a CDN. 60s smooths repeat loads
        // without leaking one user's ownership flags to another.
        "Cache-Control": "private, max-age=60",
      },
    },
  );
}

export async function POST(req: NextRequest) {
  let body: { turnstileToken?: unknown; author_name?: unknown; body?: unknown; rating?: unknown; product_slug?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  // Distributed rate limit: 3 reviews per IP per day (Upstash Redis).
  const ip = getClientIP(req);
  const { success: rlOk } = await reviewRateLimit.limit(ip);
  if (!rlOk) {
    return NextResponse.json(
      { error: "Too many reviews. Please try again tomorrow." },
      { status: 429 }
    );
  }

  // Bot gate: every review submission must pass Turnstile.
  const turnstileToken = String(body?.turnstileToken ?? "");
  const isHuman = await verifyTurnstileToken(turnstileToken);
  if (!isHuman) {
    return NextResponse.json(
      { error: "Human verification failed. Please try again." },
      { status: 403 }
    );
  }

  const author_name = String(body?.author_name ?? "").trim();
  const text = String(body?.body ?? "").trim();
  const rating = body?.rating == null ? null : Number(body.rating);
  const product_slug = body?.product_slug ? String(body.product_slug) : null;

  if (!author_name || author_name.length > 40) {
    return NextResponse.json({ error: "Name must be 1-40 characters." }, { status: 400 });
  }
  if (!text || text.length > 1000) {
    return NextResponse.json({ error: "Review must be 1-1000 characters." }, { status: 400 });
  }
  if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return NextResponse.json({ error: "Rating must be 1-5." }, { status: 400 });
  }

  // If the caller is OTP-verified, persist their phone so they (and only
  // they) can later edit/delete this review. Anonymous submissions stay
  // un-editable forever — the existing flow is unchanged for them.
  const verified = getVerifiedPhone(req);
  const customer_phone = verified ? normalizePhone(verified.phone) : null;

  const { data, error } = await supabaseAdmin
    .from("reviews")
    .insert({ product_slug, author_name, rating, body: text, customer_phone })
    .select(
      "id, product_slug, author_name, rating, body, likes_count, created_at, edited_at"
    )
    .single();
  if (error) {
    console.error("review insert failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    review: {
      ...data,
      author_name: publicDisplayName(data.author_name),
      is_owner: !!customer_phone,
      replies: [],
    },
  });
}
