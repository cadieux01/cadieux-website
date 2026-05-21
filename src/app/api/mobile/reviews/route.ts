// /api/mobile/reviews
// Mobile-equivalent of website's POST /api/reviews.
// Differences from web:
//  - Bearer-auth (phone-verified) instead of Turnstile
//  - Per-phone rate limit (3/day) — web rate limits per IP
//  - Display name is user-supplied; the verified phone is persisted as
//    customer_phone so the author can later edit/delete their own
//    review within the 24h window enforced by PATCH/DELETE /api/reviews/[id]
//
// MOBILE_APP_KEY is friction layer not real secret. Bearer is the real gate.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getVerifiedPhone,
  isValidMobileAppKey,
  maskPhone,
  normalizePhone,
} from "@/lib/phone-cookie";
import { publicDisplayName } from "@/lib/review-display";
import { toLocal10 } from "@/lib/order-validation";
import { mobileReviewRateLimit } from "@/lib/ratelimit";
import { getProductBySlug } from "@/lib/products";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

type ReviewBody = {
  rating: number;
  body: string;
  product_slug: string | null;
  display_name: string;
};

function fail(status: number, error: string, code?: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

function validateShape(
  raw: unknown,
):
  | { ok: true; body: ReviewBody }
  | { ok: false; status: number; error: string; code: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, status: 400, error: "Bad JSON", code: "bad_json" };
  }
  const r = raw as Record<string, unknown>;

  // rating — integer 1-5
  const rating = Number(r.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return {
      ok: false,
      status: 400,
      error: "Rating must be 1-5.",
      code: "rating",
    };
  }

  // body — 10-500 chars after trim
  const body = String(r.body ?? "").trim();
  if (body.length < 10 || body.length > 500) {
    return {
      ok: false,
      status: 400,
      error: "Review must be 10-500 characters.",
      code: "body",
    };
  }

  // display_name — 1-40 chars
  const display_name = String(r.display_name ?? "").trim();
  if (!display_name || display_name.length > 40) {
    return {
      ok: false,
      status: 400,
      error: "Name must be 1-40 characters.",
      code: "display_name",
    };
  }

  // product_slug — null or non-empty string (real validation in caller)
  let product_slug: string | null = null;
  if (r.product_slug !== null && r.product_slug !== undefined) {
    const p = String(r.product_slug).trim();
    if (p) product_slug = p;
  }

  return { ok: true, body: { rating, body, product_slug, display_name } };
}

export async function POST(req: NextRequest) {
  // Fail closed if MOBILE_APP_KEY isn't configured.
  if (!process.env.MOBILE_APP_KEY) {
    return fail(500, "Server misconfigured");
  }

  // 1. App-key friction check.
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return fail(401, "Unauthorized");
  }

  // 2. Bearer-token auth.
  const verified = getVerifiedPhone(req);
  if (!verified) {
    return fail(401, "Phone not verified");
  }

  // 3. Strip +91 to local 10-digit form for rate-limit key.
  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) {
    return fail(400, "Verified phone is not in expected format");
  }

  // 4. Validate body shape.
  const raw = await req.json().catch(() => null);
  const shape = validateShape(raw);
  if (!shape.ok) {
    return fail(shape.status, shape.error, shape.code);
  }
  const { rating, body, product_slug, display_name } = shape.body;

  // 5. If a product_slug is supplied, it must match an active product.
  if (product_slug) {
    const product = await getProductBySlug(product_slug);
    if (!product) {
      return fail(400, "Unknown product.", "product_unknown");
    }
  }

  // 6. Per-phone daily rate limit. Keyed on the 10-digit local phone so
  //    multiple users on the same carrier NAT don't share a quota.
  const { success: rlOk, reset } =
    await mobileReviewRateLimit.limit(phoneLocal);
  if (!rlOk) {
    console.warn("[mobile/reviews] rate limited", {
      phone: maskPhone(phoneLocal),
    });
    return NextResponse.json(
      {
        ok: false,
        error: "You've hit the daily review limit. Try again tomorrow.",
        code: "rate_limited",
        resetAt: reset,
      },
      { status: 429 },
    );
  }

  // 7. Insert. Service role — RLS on this table allows authenticated
  //    inserts elsewhere; we bypass it here because the request was
  //    authenticated via the Bearer + app-key pair above.
  const { data, error } = await supabaseAdmin
    .from("reviews")
    .insert({
      product_slug,
      author_name: display_name,
      rating,
      body,
      customer_phone: normalizePhone(verified.phone),
    })
    .select(
      "id, product_slug, author_name, rating, body, likes_count, created_at, edited_at",
    )
    .single();

  if (error || !data) {
    console.error("[mobile/reviews] insert failed:", error);
    // Map known Postgres failure modes to actionable client errors, and
    // surface the raw message/code in dev so a stuck mobile build can
    // diagnose schema drift without server-log access. Web does the
    // same (returns error.message at /api/reviews POST).
    if (error) {
      // 23505 = unique_violation. Most likely cause here is a UNIQUE
      // (customer_phone, product_slug) constraint hit when the same
      // verified phone tries to review the same product twice.
      if (error.code === "23505") {
        return fail(
          409,
          "You've already reviewed this product. Edit your existing review instead.",
          "duplicate_review",
        );
      }
      // 23502 = not_null_violation. Hints at a column the insert isn't
      // populating that the schema now requires.
      if (error.code === "23502") {
        return fail(500, error.message ?? "Missing required field", "not_null");
      }
      // 42703 = undefined_column. Insert is referencing a column that
      // doesn't exist in production — schema drift between repo and DB.
      if (error.code === "42703") {
        return fail(500, error.message ?? "Schema mismatch", "undefined_column");
      }
      // 23503 = foreign_key_violation.
      if (error.code === "23503") {
        return fail(400, error.message ?? "Invalid reference", "fk_violation");
      }
    }
    // Generic fallback — return Postgres' own message so the mobile
    // toast / dev log can see what actually went wrong instead of the
    // opaque "Failed to save review".
    return fail(500, error?.message ?? "Failed to save review", error?.code);
  }

  return NextResponse.json({
    ok: true,
    review: {
      ...data,
      author_name: publicDisplayName(data.author_name),
      is_owner: true,
      replies: [],
    },
  });
}
