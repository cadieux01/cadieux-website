import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

const ALLOWED_STATUSES = new Set(["active", "completed", "cancelled", "paused"]);
const ALLOWED_PAYMENT_STATUSES = new Set(["pending", "paid", "failed", "refunded"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.status === "string") {
    const s = body.status.toLowerCase();
    if (!ALLOWED_STATUSES.has(s)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    update.status = s;
  }
  if (typeof body.payment_status === "string") {
    const ps = body.payment_status.toLowerCase();
    if (!ALLOWED_PAYMENT_STATUSES.has(ps)) {
      return NextResponse.json({ error: "Invalid payment_status" }, { status: 400 });
    }
    update.payment_status = ps;
  }

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("subscriptions")
    .update(update)
    .eq("id", params.id);

  if (error) {
    console.error("[admin/subscriptions PATCH]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
