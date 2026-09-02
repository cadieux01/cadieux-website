import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import {
  buildDerivations,
  type DeliveryLite,
} from "@/lib/admin-subscription-derive";
import { recordAuditEvent, type AuditAction } from "@/lib/audit-log";

const ALLOWED_STATUSES = new Set(["active", "completed", "cancelled", "paused"]);
const ALLOWED_PAYMENT_STATUSES = new Set(["pending", "paid", "failed", "refunded"]);

/**
 * Single-subscription detail for /admin/subscriptions/[id].
 *
 * `select("*")` deliberately — the subscriptions table carries both the
 * current columns and the original wizard's ones (bread_*, days,
 * slots_by_day, customer_*), and rows written by different eras of the
 * checkout populate different subsets. The detail page shows whatever is
 * there, so narrowing the projection would silently hide real data.
 *
 * Deliveries come back on the same response (the list endpoint the drawer
 * uses is per-subscription too, but the page needs them to render at all).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: sub, error } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();

  if (error) {
    console.error("[admin/subscriptions GET]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!sub) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // customer_id is nullable on legacy rows — those fall back to the
  // customer_name / customer_phone snapshot stored on the subscription.
  let customer = null;
  if (sub.customer_id) {
    const { data } = await supabaseAdmin
      .from("customers")
      .select("id, full_name, phone, email, city")
      .eq("id", sub.customer_id)
      .maybeSingle();
    customer = data ?? null;
  }

  const { data: deliveries } = await supabaseAdmin
    .from("subscription_deliveries")
    .select("*")
    .eq("subscription_id", params.id)
    .order("sequence", { ascending: true });

  const derived = buildDerivations(
    [{ id: sub.id, total_weeks: sub.total_weeks, created_at: sub.created_at }],
    (deliveries as DeliveryLite[]) ?? [],
  ).get(sub.id);

  return NextResponse.json({
    subscription: { ...sub, customer, ...derived },
    deliveries: deliveries ?? [],
  });
}

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
