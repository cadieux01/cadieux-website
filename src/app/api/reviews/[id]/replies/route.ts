// POST /api/reviews/[id]/replies
//
// Replies are now admin-only. The previous implementation accepted any
// caller and only used `is_admin` to control the badge — meaning the
// public could spam replies on any review. Phase 2 hardening:
//   1. Require a valid admin session (verifyAdminSession via isAdmin).
//   2. Validate input shape with zod (1–1000 chars, no HTML).
//   3. Rate limit: 10 replies per minute per admin session.
//   4. Audit every successful reply (recordAuditEvent).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { isAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { adminReplyRateLimit, getClientIP } from "@/lib/ratelimit";
import { parseBody, ReviewReplySchema } from "@/lib/validation";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit keyed by the admin_session cookie value (falls back to
  // IP if the cookie is missing — shouldn't happen post-isAdmin check
  // but defensive). 10 replies/min is more than enough for genuine
  // moderation work, well under what a runaway script would emit.
  const sessionKey =
    req.cookies.get("admin_session")?.value ?? getClientIP(req);
  const rl = await adminReplyRateLimit.limit(`reply:${sessionKey}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many replies. Please slow down." },
      { status: 429 },
    );
  }

  const parsed = await parseBody(req, ReviewReplySchema);
  if (!parsed.ok) return parsed.response;
  const { author_name, body: text } = parsed.data;

  const { data, error } = await supabaseAdmin
    .from("review_replies")
    .insert({
      review_id: params.id,
      author_name,
      body: text,
      // Replies are admin-only now — always flag as such.
      is_admin: true,
    })
    .select("id, review_id, author_name, is_admin, body, likes_count, created_at")
    .single();
  if (error) {
    console.error("reply insert failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (data) {
    void recordAuditEvent({
      req,
      entity: "review",
      action: "create",
      targetId: data.id,
      targetLabel: data.id,
      context: "Admin posted reply",
      meta: { review_id: params.id, reply_id: data.id },
    });
  }
  return NextResponse.json({ reply: data });
}
