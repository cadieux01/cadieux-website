import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import {
  buildDerivations,
  type DeliveryLite,
} from "@/lib/admin-subscription-derive";
import { matchSubscriptionCoordinates } from "@/lib/subscription-coordinates";
import { recordAuditEvent, type AuditAction } from "@/lib/audit-log";

const ALLOWED_STATUSES = new Set([
  "pending_confirmation",
  "active",
  "completed",
  "cancelled",
  "paused",
]);
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

  // Match GPS coords from the customer's saved addresses (subscriptions
  // carry none). null → the detail page's Maps link uses address text.
  let coords: { latitude: number; longitude: number } | null = null;
  if (sub.customer_id) {
    const { data: addresses } = await supabaseAdmin
      .from("addresses")
      .select("line1, pincode, is_default, latitude, longitude")
      .eq("customer_id", sub.customer_id);
    coords = matchSubscriptionCoordinates(addresses, {
      line1: sub.delivery_address?.line1 ?? sub.customer_address ?? null,
      pincode: sub.delivery_address?.pincode ?? sub.customer_pincode ?? null,
    });
  }

  return NextResponse.json({
    subscription: { ...sub, customer, ...derived, ...(coords ?? {}) },
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

  // Optional optimistic-concurrency guard. When the client passes the
  // status it believes is current, we only write if the row STILL has
  // that status — so a stale drawer can't silently clobber a change made
  // elsewhere. Omitting expected_status keeps the old behaviour exactly.
  const expected =
    typeof body.expected_status === "string"
      ? body.expected_status.toLowerCase()
      : null;

  const { data: before } = await supabaseAdmin
    .from("subscriptions")
    .select("status, payment_status, product_name")
    .eq("id", params.id)
    .maybeSingle();

  let updateQuery = supabaseAdmin
    .from("subscriptions")
    .update(update)
    .eq("id", params.id);
  if (expected) {
    updateQuery = updateQuery.eq("status", expected);
  }
  const { data: updatedRows, error } = await updateQuery.select("id");

  if (error) {
    console.error("[admin/subscriptions PATCH]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Conditional write matched no row → the status moved under us.
  if (expected && (!updatedRows || updatedRows.length === 0)) {
    return NextResponse.json(
      {
        error: "This was already changed elsewhere — reload to see the current state.",
        code: "stale",
        current_status: before?.status ?? null,
      },
      { status: 409 },
    );
  }

  // Cancelling a subscription cancels the deliveries that haven't happened
  // yet. Same statement the customer-facing route already runs
  // (api/subscriptions/[id]/cancel) — without it an admin cancel left
  // pending_confirmation deliveries behind, still looking live on the
  // board. delivered/cancelled rows are history and stay untouched.
  let cascadedDeliveries: number | null = null;
  if (update.status === "cancelled" && before?.status !== "cancelled") {
    const { data: cascaded, error: cascadeErr } = await supabaseAdmin
      .from("subscription_deliveries")
      .update({ status: "cancelled", status_updated_at: update.updated_at })
      .eq("subscription_id", params.id)
      .not("status", "in", "(delivered,cancelled)")
      .select("id");
    if (cascadeErr) {
      // The subscription IS cancelled — don't fail the request over the
      // cascade, but never report a number we didn't write.
      console.error("[admin/subscriptions PATCH cascade]", cascadeErr.message);
    } else {
      cascadedDeliveries = cascaded?.length ?? 0;
    }
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
      // Only present on a cancel; null when the cascade query errored.
      ...(update.status === "cancelled" && before?.status !== "cancelled"
        ? { cascaded_deliveries_cancelled: cascadedDeliveries }
        : {}),
    },
  });

  return NextResponse.json({ ok: true, cascaded_deliveries: cascadedDeliveries });
}
