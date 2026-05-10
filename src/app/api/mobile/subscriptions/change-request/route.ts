// POST /api/mobile/subscriptions/change-request
// Submit a change request for a delivery that is within 24h of scheduled date
// (when the self-edit endpoint is no longer available). An admin reviews and
// applies the change.
//
// Body: { delivery_id, requested_date?, requested_time_slot?, reason? }
// Ownership verified via customer_id FK — mirrors the web change-request route.
// No Turnstile; mobile bearer is the gate.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone, isValidMobileAppKey } from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function fail(status: number, error: string, code?: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

export async function POST(req: NextRequest) {
  if (!process.env.MOBILE_APP_KEY) return fail(500, "Server misconfigured");
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return fail(401, "Unauthorized");
  }
  const verified = getVerifiedPhone(req);
  if (!verified) return fail(401, "Phone not verified");
  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) {
    return fail(400, "Verified phone is not in expected format");
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const { delivery_id, requested_date, requested_time_slot, reason } = body;

  if (!delivery_id) {
    return fail(400, "Missing delivery_id.", "delivery_id");
  }
  if (!requested_date && !requested_time_slot) {
    return fail(400, "Provide a new date or time slot.", "fields");
  }

  // Fetch delivery to get its subscription_id.
  const { data: delivery, error: delErr } = await supabaseAdmin
    .from("subscription_deliveries")
    .select("id, subscription_id, scheduled_date, status")
    .eq("id", delivery_id)
    .maybeSingle();
  if (delErr) {
    console.error("[mobile/change-request] delivery lookup:", delErr);
    return fail(500, "Failed to resolve delivery");
  }
  if (!delivery) return fail(404, "Not found");

  // Resolve customer and verify subscription ownership via customer_id.
  const { data: customer, error: custErr } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (custErr) {
    console.error("[mobile/change-request] customer lookup:", custErr);
    return fail(500, "Failed to resolve customer");
  }
  if (!customer) return fail(404, "Not found");

  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("id, status")
    .eq("id", delivery.subscription_id)
    .eq("customer_id", customer.id)
    .maybeSingle();
  if (!sub) return fail(404, "Not found");

  if (sub.status === "cancelled" || sub.status === "completed") {
    return fail(400, "Subscription is not active.", "sub_status");
  }
  if (
    delivery.status === "out_for_delivery" ||
    delivery.status === "delivered"
  ) {
    return fail(400, "This delivery is already in progress.", "delivery_status");
  }

  // Don't allow stacking a second pending request on the same delivery.
  const { data: existing } = await supabaseAdmin
    .from("subscription_change_requests")
    .select("id")
    .eq("delivery_id", delivery_id)
    .eq("status", "pending")
    .maybeSingle();
  if (existing) {
    return fail(
      409,
      "A change request for this delivery is already pending.",
      "already_pending",
    );
  }

  const { data: cr, error: crErr } = await supabaseAdmin
    .from("subscription_change_requests")
    .insert({
      delivery_id,
      subscription_id: delivery.subscription_id,
      requested_date: requested_date ?? null,
      requested_time_slot: requested_time_slot ?? null,
      reason: reason ?? null,
      status: "pending",
    })
    .select("id")
    .single();

  if (crErr || !cr) {
    console.error("[mobile/change-request] insert:", crErr);
    return fail(500, "Failed to submit request");
  }

  return NextResponse.json({ ok: true, id: cr.id });
}
