import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent, type AuditAction } from "@/lib/audit-log";

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

  const { data: before } = await supabaseAdmin
    .from("subscriptions")
    .select("status, payment_status, product_name")
    .eq("id", params.id)
    .maybeSingle();

  const { error } = await supabaseAdmin
    .from("subscriptions")
    .update(update)
    .eq("id", params.id);

  if (error) {
    console.error("[admin/subscriptions PATCH]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Map the most informative status transition to a specific action so
  // the audit log reads naturally; otherwise fall back to "update".
  let action: AuditAction = "update";
  if (typeof update.status === "string" && before?.status !== update.status) {
    if (update.status === "cancelled") action = "cancel";
    else if (update.status === "paused") action = "pause";
    else if (update.status === "active" && before?.status === "paused") {
      action = "resume";
    } else action = "status_change";
  } else if (
    typeof update.payment_status === "string" &&
    before?.payment_status !== update.payment_status
  ) {
    action = update.payment_status === "refunded" ? "refund" : "status_change";
  }

  void recordAuditEvent({
    req,
    entity: "subscription",
    action,
    targetId: params.id,
    targetLabel: before?.product_name ?? `#${params.id.slice(0, 8)}`,
    context: `Subscription ${params.id.slice(0, 8)} → ${action}`,
    meta: {
      fields: Object.keys(update).filter((k) => k !== "updated_at"),
      status_before: before?.status ?? null,
      status_after: update.status ?? null,
      payment_status_before: before?.payment_status ?? null,
      payment_status_after: update.payment_status ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}
