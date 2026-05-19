import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { recordAuditEvent } from "@/lib/audit-log";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }

  const author_name = String(body?.author_name ?? "").trim();
  const text = String(body?.body ?? "").trim();
  // is_admin only honored if the request carries the admin token
  const wantsAdmin = body?.is_admin === true;
  const adminOk = req.headers.get("x-admin-token") === process.env.ADMIN_TOKEN;
  const is_admin = wantsAdmin && adminOk;

  if (!author_name || author_name.length > 40) {
    return NextResponse.json({ error: "Name must be 1-40 characters." }, { status: 400 });
  }
  if (!text || text.length > 1000) {
    return NextResponse.json({ error: "Reply must be 1-1000 characters." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("review_replies")
    .insert({ review_id: params.id, author_name, body: text, is_admin })
    .select("id, review_id, author_name, is_admin, body, likes_count, created_at")
    .single();
  if (error) {
    console.error("reply insert failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // Audit only admin-authored replies — visitor replies aren't
  // operator actions and would flood the log.
  if (is_admin && data) {
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
