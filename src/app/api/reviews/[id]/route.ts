// PATCH + DELETE for a single review.
//
// Two callers:
//   - Admin (admin_session cookie or Bearer). Full moderation: PATCH a
//     partial set of body / rating / author_name, and/or toggle
//     is_deleted (soft-delete / restore). DELETE is a SOFT delete only —
//     never hard-removes the row (project rule).
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

  // Admin: SOFT delete only (project rule — never hard-delete). Restore is
  // done via PATCH { is_deleted: false }. The public GET filters
  // is_deleted=true, so this hides the review on web + app immediately.
  if (isAdmin(req)) {
    const { error } = await supabaseAdmin
      .from("reviews")
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) {
      console.error("review soft-delete failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    void recordAuditEvent({
      req,
      entity: "review",
      action: "delete",
      targetId: id,
      targetLabel: id,
      context: "Admin soft-deleted review",
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

  let payload: {
    body?: unknown;
    rating?: unknown;
    author_name?: unknown;
    is_deleted?: unknown;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ---- Admin path: flexible partial edit + soft-delete / restore. ----
  // Any subset of body / rating / author_name may be supplied, and/or an
  // is_deleted toggle. Content edits stamp is_edited + edited_at.
  if (isAdmin(req)) {
    const update: Record<string, unknown> = {};
    let contentChanged = false;

    if (payload.body !== undefined) {
      const b = typeof payload.body === "string" ? payload.body.trim() : "";
      if (!b || b.length > 1000) {
        return NextResponse.json(
          { error: "Body must be 1–1000 chars" },
          { status: 400 }
        );
      }
      update.body = b;
      contentChanged = true;
    }
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
      contentChanged = true;
    }
    if (payload.author_name !== undefined) {
      const n =
        typeof payload.author_name === "string"
          ? payload.author_name.trim()
          : "";
      if (!n || n.length > 40) {
        return NextResponse.json(
          { error: "Name must be 1–40 chars" },
          { status: 400 }
        );
      }
      update.author_name = n;
      contentChanged = true;
    }
    if (payload.is_deleted !== undefined) {
      if (typeof payload.is_deleted !== "boolean") {
        return NextResponse.json(
          { error: "is_deleted must be a boolean" },
          { status: 400 }
        );
      }
      update.is_deleted = payload.is_deleted;
      update.deleted_at = payload.is_deleted ? new Date().toISOString() : null;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }
    if (contentChanged) {
      update.is_edited = true;
      update.edited_at = new Date().toISOString();
    }
    update.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("reviews")
      .update(update)
      .eq("id", id)
      .select(
        "id, product_slug, author_name, rating, body, likes_count, created_at, edited_at, is_edited, is_deleted, deleted_at"
      )
      .single();
    if (error) {
      console.error("review patch failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const toggledDelete = payload.is_deleted !== undefined;
    void recordAuditEvent({
      req,
      entity: "review",
      action: toggledDelete && !contentChanged ? "delete" : "update",
      targetId: id,
      targetLabel: id,
      context:
        toggledDelete && !contentChanged
          ? payload.is_deleted
            ? "Admin soft-deleted review"
            : "Admin restored review"
          : "Admin edited review",
      meta: { fields_changed: Object.keys(update) },
    });
    // Admin payload keeps the raw author_name (so the editor round-trips).
    return NextResponse.json({ review: { ...data, is_owner: false } });
  }

  // ---- Author path: body required, rating optional, ownership + 24h. ----
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
  // Mirror the shape returned by GET / POST — first-name display + the
  // is_owner flag (always true for the author path).
  return NextResponse.json({
    review: {
      ...data,
      author_name: publicDisplayName(data.author_name),
      is_owner: true,
    },
  });
}
