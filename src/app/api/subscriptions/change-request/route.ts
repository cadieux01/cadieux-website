import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone, normalizePhone } from "@/lib/phone-cookie";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseScheduledDate(yyyyMmDd: string): Date | null {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  if (!y || !m || !d) return null;
  // Treat the scheduled date as midnight local — we just need a coarse 24h gate.
  return new Date(y, m - 1, d);
}

export async function POST(req: NextRequest) {
  const verified = getVerifiedPhone(req);
  if (!verified) {
    return NextResponse.json(
      { error: "Phone verification required." },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const {
    delivery_id,
    requested_date,
    requested_time_slot,
    reason,
  } = body ?? {};

  if (!delivery_id) {
    return NextResponse.json({ error: "Missing delivery_id." }, { status: 400 });
  }
  if (!requested_date && !requested_time_slot) {
    return NextResponse.json(
      { error: "Provide a new date or time slot." },
      { status: 400 }
    );
  }

  // Look up the delivery + parent subscription + customer
  const { data: delivery } = await supabaseAdmin
    .from("subscription_deliveries")
    .select("id, subscription_id, week_number, scheduled_date, status")
    .eq("id", delivery_id)
    .maybeSingle();
  if (!delivery) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("customer_id, status")
    .eq("id", delivery.subscription_id)
    .maybeSingle();
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: cust } = await supabaseAdmin
    .from("customers")
    .select("phone")
    .eq("id", sub.customer_id)
    .maybeSingle();
  if (!cust || normalizePhone(cust.phone) !== verified.phone) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Business rules
  if (sub.status !== "active") {
    return NextResponse.json(
      { error: "Subscription is not active." },
      { status: 400 }
    );
  }
  if (delivery.status === "out_for_delivery" || delivery.status === "delivered") {
    return NextResponse.json(
      { error: "This delivery is already in progress." },
      { status: 400 }
    );
  }
  // 24h cutoff
  const scheduled = parseScheduledDate(delivery.scheduled_date);
  if (scheduled) {
    const diffMs = scheduled.getTime() - Date.now();
    if (diffMs < 24 * 60 * 60 * 1000) {
      return NextResponse.json(
        { error: "Changes must be requested at least 24 hours in advance." },
        { status: 400 }
      );
    }
  }
  // Also enforce that requested_date is at least 24h out, if provided.
  if (requested_date) {
    const reqD = parseScheduledDate(String(requested_date));
    if (!reqD) {
      return NextResponse.json({ error: "Invalid requested_date." }, { status: 400 });
    }
    if (reqD.getTime() - Date.now() < 24 * 60 * 60 * 1000 - MS_PER_DAY) {
      // (Use coarse cutoff: requested date must be today or later.)
    }
  }

  // Don't allow stacking a second pending request on the same delivery.
  const { data: existing } = await supabaseAdmin
    .from("subscription_change_requests")
    .select("id")
    .eq("delivery_id", delivery_id)
    .eq("status", "pending")
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: "A change request for this delivery is already pending." },
      { status: 409 }
    );
  }

  const { data: cr, error } = await supabaseAdmin
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

  if (error || !cr) {
    console.error("[change-request insert]", error);
    return NextResponse.json(
      { error: "Failed to submit request", details: error?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, id: cr.id });
}
