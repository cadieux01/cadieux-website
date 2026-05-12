// POST /api/mobile/subscriptions/[id]/deliveries/[deliveryId]/edit
// Customer self-edit for an upcoming delivery.
//
// Rules (mirror the web PATCH endpoint — minus Turnstile):
//  - Delivery status must be pending_confirmation or confirmed.
//  - Scheduled date must be ≥24h away (edit cutoff; placement cutoff is 12h, separate).
//  - Rate-limited: 10 edits/day per phone (key: sub-edit:mobile:${phoneLocal}).
//  - Body: { scheduled_date?, scheduled_time_slot? } — at least one required.
//  - Ownership verified via customer_id FK (no phone fuzzy-match).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getVerifiedPhone,
  isValidMobileAppKey,
  maskPhone,
} from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";
import { editRateLimit } from "@/lib/ratelimit";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.cadieux.in";

// 14 one-hour slots 06:00..19:00 (HH:MM start). Must stay in sync with
// lib/timeSlots.ts in the mobile app and the web edit endpoint.
const ALLOWED_TIME_SLOTS = new Set<string>(
  Array.from({ length: 14 }, (_, i) => {
    const h = 6 + i;
    return `${String(h).padStart(2, "0")}:00`;
  }),
);

// Edit cutoff: 24h (operational reroute window).
// Placement cutoff (12h) is separate — see /api/mobile/subscriptions POST.
const EDIT_GAP_MS = 24 * 60 * 60 * 1000;

function fail(status: number, error: string, code?: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

function parseDate(yyyyMmDd: string): Date | null {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function fireAndForget(
  p: Promise<Response>,
  label: string,
  ctx: { phone: string },
): void {
  p.then(async (res) => {
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string | number;
      };
      console.error(`[mobile/sub edit] ${label} http_failed`, {
        status: res.status,
        code: data.code,
        error: data.error,
        phone: maskPhone(ctx.phone),
      });
    }
  }).catch((err) => {
    console.error(`[mobile/sub edit] ${label} threw`, {
      phone: maskPhone(ctx.phone),
      err: String(err),
    });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; deliveryId: string } },
) {
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

  // Rate limit: 10 edits/day keyed by phone (separate namespace from web).
  const { success: rlOk } = await editRateLimit.limit(
    `sub-edit:mobile:${phoneLocal}`,
  );
  if (!rlOk) {
    return fail(429, "Too many edits today. Please try again tomorrow.");
  }

  const body = await req.json().catch(() => ({}));
  const scheduledDate: string | null =
    typeof body.scheduled_date === "string" && body.scheduled_date
      ? body.scheduled_date
      : null;
  const scheduledSlot: string | null =
    typeof body.scheduled_time_slot === "string" && body.scheduled_time_slot
      ? body.scheduled_time_slot
      : null;

  if (!scheduledDate && !scheduledSlot) {
    return fail(400, "Provide a new date or time slot.", "fields");
  }

  // Validate new date — must be ≥24h in the future.
  if (scheduledDate) {
    const d = parseDate(scheduledDate);
    if (!d) return fail(400, "Invalid scheduled_date.", "scheduled_date");
    if (d.getTime() - Date.now() < EDIT_GAP_MS - 1000) {
      return fail(
        400,
        "New date must be at least 24 hours away.",
        "scheduled_date",
      );
    }
  }
  if (scheduledSlot && !ALLOWED_TIME_SLOTS.has(scheduledSlot)) {
    return fail(400, "Invalid time slot.", "scheduled_time_slot");
  }

  // Ownership: resolve customer from bearer phone.
  const { data: customer, error: custErr } = await supabaseAdmin
    .from("customers")
    .select("id, full_name")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (custErr) {
    console.error("[mobile/sub edit] customer lookup:", custErr);
    return fail(500, "Failed to resolve customer");
  }
  if (!customer) return fail(404, "Not found");

  // Verify subscription belongs to this customer.
  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("id, status, bread_name, product_name")
    .eq("id", params.id)
    .eq("customer_id", customer.id)
    .maybeSingle();
  if (!sub) return fail(404, "Not found");

  if (sub.status === "cancelled" || sub.status === "completed") {
    return fail(400, "Subscription is not active.", "sub_status");
  }

  // Fetch delivery — also verify it belongs to this subscription.
  const { data: delivery } = await supabaseAdmin
    .from("subscription_deliveries")
    .select(
      "id, subscription_id, scheduled_date, scheduled_time_slot, status, admin_notes",
    )
    .eq("id", params.deliveryId)
    .eq("subscription_id", params.id)
    .maybeSingle();
  if (!delivery) return fail(404, "Not found");

  // Status gate: only editable while pending_confirmation or confirmed.
  if (
    delivery.status !== "pending_confirmation" &&
    delivery.status !== "confirmed"
  ) {
    return fail(
      400,
      "This delivery can no longer be changed.",
      "delivery_status",
    );
  }

  // 24h gate on the *current* scheduled date. Within 24h → use change-request.
  const currentDate = parseDate(delivery.scheduled_date);
  if (!currentDate || currentDate.getTime() - Date.now() < EDIT_GAP_MS - 1000) {
    return fail(
      400,
      "Within 24 hours of delivery — please send a change request for admin approval.",
      "too_soon",
    );
  }

  // Build update + audit trail in admin_notes.
  const oldDate = delivery.scheduled_date;
  const oldSlot = delivery.scheduled_time_slot as string | null;
  const finalDate = scheduledDate ?? oldDate;
  const finalSlot = scheduledSlot ?? oldSlot;

  const stamp = new Date().toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const editLine = `[user edit (mobile) ${stamp}] ${oldDate} ${oldSlot ?? "-"} → ${finalDate} ${finalSlot ?? "-"}`;
  const nextNotes = delivery.admin_notes
    ? `${delivery.admin_notes as string}\n${editLine}`
    : editLine;

  const update: Record<string, unknown> = {
    status_updated_at: new Date().toISOString(),
    admin_notes: nextNotes,
  };
  if (scheduledDate) update.scheduled_date = scheduledDate;
  if (scheduledSlot) update.scheduled_time_slot = scheduledSlot;

  const { data: updated, error: uErr } = await supabaseAdmin
    .from("subscription_deliveries")
    .update(update)
    .eq("id", params.deliveryId)
    .select("*")
    .single();
  if (uErr || !updated) {
    console.error("[mobile/sub edit] delivery update:", uErr);
    return fail(500, "Failed to update delivery");
  }

  // Fire-and-forget WhatsApp notification.
  const productName = sub.product_name || sub.bread_name || "subscription";
  const waMessage =
    `Hi ${customer.full_name || "there"}! Your Cadieux ${productName} delivery has been updated.\n\n` +
    `New date: ${finalDate}\n` +
    (finalSlot ? `New time: ${finalSlot}\n` : "") +
    `\nQuestions? Contact support@cadieux.in.`;
  fireAndForget(
    fetch(`${SITE_URL}/api/send-whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phoneLocal, message: waMessage }),
    }),
    "send-whatsapp-edit",
    { phone: phoneLocal },
  );

  return NextResponse.json({ ok: true, delivery: updated });
}
