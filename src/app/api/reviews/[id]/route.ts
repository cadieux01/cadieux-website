// PATCH + DELETE for a single review.
//
// Two callers:
//   - Admin (admin_session cookie). Same powers as before — PATCH any
//     field, DELETE hard-removes the row. Used by /admin tooling.
//   - Author (OTP-verified via cookie or bearer header). Can only touch
//     their OWN review (customer_phone match), only inside the 24h
//     edit window, and DELETE is a soft delete that flips is_deleted=true
//     without removing the row (kept for audit).
//
// The previous implementation had no auth on PATCH at all — any caller
// holding a review id could rewrite its body/rating. The ownership check
// below closes that gap.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { getVerifiedPhone, normalizePhone } from "@/lib/phone-cookie";
import { isWithinEditWindow, publicDisplayName } from "@/lib/review-display";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

/** Fetch the row needed for ownership / state checks. */
async function loadReview(id: string) {
  const { data, error } = await supabaseAdmin
    .from("reviews")
    .select("id, customer_phone, created_at, is_deleted")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return { ok: false as const, status: 500, error: error.message };
  }
  if (!data) {
    return { ok: false as const, status: 404, error: "Not found" };
  }
  return { ok: true as const, row: data };
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  // Admin: keep the existing hard-delete escape hatch.
  if (isAdmin(req)) {
    const { error } = await supabaseAdmin
      .from("reviews")
      .delete()
      .eq("id", id);
    if (error) {
      console.error("review delete failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    void recordAuditEvent({
      req,
      entity: "review",
      action: "delete",
      targetId: id,
      targetLabel: id,
      context: "Admin hard-deleted review",
      meta: null,
    });
    return NextResponse.json({ ok: true });
  }

  // Author: phone-ownership + soft delete.
  const verified = getVerifiedPhone(req);
  if (!verified) {
    return NextResponse.json(
      { error: "Phone verification required." },
      { status: 401 }
    );
  }
  const verifiedPhone = normalizePhone(verified.phone);

  const loaded = await loadReview(id);
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }
  const row = loaded.row;

  if (!row.customer_phone || normalizePhone(row.customer_phone) !== verifiedPhone) {
    return NextResponse.json({ error: "Not your review." }, { status: 403 });
  }
  if (row.is_deleted) {
    // Idempotent: already gone, treat as success.
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabaseAdmin
    .from("reviews")
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("review soft-delete failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  let payload: { body?: unknown; rating?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const newBody =
    typeof payload?.body === "string" ? payload.body.trim() : "";
  if (!newBody || newBody.length > 1000) {
    return NextResponse.json(
      { error: "Body must be 1–1000 chars" },
      { status: 400 }
    );
  }
  const update: { body: string; edited_at: string; rating?: number | null } = {
    body: newBody,
    edited_at: new Date().toISOString(),
  };
  if (payload.rating !== undefined) {
    const r = payload.rating;
    if (r === null) update.rating = null;
    else if (typeof r === "number" && r >= 1 && r <= 5)
      update.rating = Math.round(r);
    else
      return NextResponse.json(
        { error: "Rating must be 1–5 or null" },
        { status: 400 }
      );
  }

  // Admin: skip ownership / window checks (existing behaviour).
  if (!isAdmin(req)) {
    const verified = getVerifiedPhone(req);
    if (!verified) {
      return NextResponse.json(
        { error: "Phone verification required." },
        { status: 401 }
      );
    }
    const verifiedPhone = normalizePhone(verified.phone);

    const loaded = await loadReview(id);
    if (!loaded.ok) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }
    const row = loaded.row;

    if (!row.customer_phone || normalizePhone(row.customer_phone) !== verifiedPhone) {
      return NextResponse.json({ error: "Not your review." }, { status: 403 });
    }
    if (row.is_deleted) {
      return NextResponse.json(
        { error: "Review has been deleted." },
        { status: 400 }
      );
    }
    if (!isWithinEditWindow(row.created_at)) {
      return NextResponse.json(
        { error: "Edit window closed — reviews can only be edited within 24 hours." },
        { status: 403 }
      );
    }
  }

  const { data, error } = await supabaseAdmin
    .from("reviews")
    .update(update)
    .eq("id", id)
    .select(
      "id, product_slug, author_name, rating, body, likes_count, created_at, edited_at"
    )
    .single();
  if (error) {
    console.error("review patch failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // Audit admin edits (skip author self-edits — those happen in the
  // 24h author edit window and are not operator actions).
  if (isAdmin(req)) {
    void recordAuditEvent({
      req,
      entity: "review",
      action: "update",
      targetId: id,
      targetLabel: id,
      context: "Admin edited review",
      meta: { fields_changed: Object.keys(update) },
    });
  }
  // Mirror the shape returned by GET / POST — first-name display + the
  // is_owner flag (always true for the author path; admin callers will
  // ignore it).
  return NextResponse.json({
    review: {
      ...data,
      author_name: publicDisplayName(data.author_name),
      is_owner: !isAdmin(req),
    },
  });
}
