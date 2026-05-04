import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { reviewRateLimit, getClientIP } from "@/lib/ratelimit";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function GET(req: NextRequest) {
  const product = req.nextUrl.searchParams.get("product");
  let q = supabaseAdmin
    .from("reviews")
    .select("id, product_slug, author_name, rating, body, likes_count, created_at")
    .order("created_at", { ascending: false });
  if (product) q = q.eq("product_slug", product);
  const { data: reviews, error } = await q;
  if (error) {
    console.error("reviews list failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (reviews ?? []).map((r) => r.id);
  let replies: any[] = [];
  if (ids.length) {
    const { data: rdata, error: rerr } = await supabaseAdmin
      .from("review_replies")
      .select("id, review_id, author_name, is_admin, body, likes_count, created_at")
      .in("review_id", ids)
      .order("created_at", { ascending: true });
    if (rerr) {
      console.error("replies fetch failed:", rerr);
      return NextResponse.json({ error: rerr.message }, { status: 500 });
    }
    replies = rdata ?? [];
  }

  const byReview = new Map<string, any[]>();
  for (const r of replies) {
    const arr = byReview.get(r.review_id) ?? [];
    arr.push(r);
    byReview.set(r.review_id, arr);
  }
  const out = (reviews ?? []).map((r) => ({ ...r, replies: byReview.get(r.id) ?? [] }));
  return NextResponse.json({ reviews: out });
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }

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

  const { data, error } = await supabaseAdmin
    .from("reviews")
    .insert({ product_slug, author_name, rating, body: text })
    .select("id, product_slug, author_name, rating, body, likes_count, created_at")
    .single();
  if (error) {
    console.error("review insert failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ review: { ...data, replies: [] } });
}
