// Customer self-edit for an upcoming delivery. Allowed only when the
// scheduled delivery is more than ~24 hours away and the delivery is still
// in pending_confirmation / confirmed. Anything tighter than that must use
// the change-request flow (admin approval). All gates run server-side; the
// client `address_source` / `mode` flag is hint-only.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone, normalizePhone } from "@/lib/phone-cookie";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { editRateLimit } from "@/lib/ratelimit";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Mirrors the dropdown shown on the delivery detail page — 14 one-hour
// blocks from 6 AM to 8 PM, same shape as the new setup wizard. Server only
// accepts these exact strings; legacy slot values already in the DB are not
// validated since we never re-write them unless the user picks a new one.
const ALLOWED_TIME_SLOTS = new Set<string>(
  Array.from({ length: 14 }, (_, i) => {
    const h = 6 + i;
    const a = String(h).padStart(2, "0");
    const b = String(h + 1).padStart(2, "0");
    return `${a}:00-${b}:00`;
  })
);

const MS_DAY = 24 * 60 * 60 * 1000;

function parseDate(yyyyMmDd: string): Date | null {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; deliveryId: string } }
) {
  // 1. Phone auth. Accepts the web cookie (HMAC, 30-min TTL) or a mobile
  //    bearer token (HMAC, 30-day TTL) — same signer, interchangeable.
  const verified = getVerifiedPhone(req);
  if (!verified) {
    return NextResponse.json(
      { error: "Phone verification required." },
      { status: 401 }
    );
  }

  // 2. Body shape.
  const body = await req.json().catch(() => ({}));
  const newDate: string | null =
    typeof body.new_date === "string" && body.new_date ? body.new_date : null;
  const newSlot: string | null =
    typeof body.new_time_slot === "string" && body.new_time_slot
      ? body.new_time_slot
      : null;
  const turnstileToken = String(body.turnstile_token ?? "");

  if (!newDate && !newSlot) {
    return NextResponse.json(
      { error: "Provide a new date or a new time slot." },
      { status: 400 }
    );
  }

  // 3. Bot gate. Run before DB lookups so probes can't enumerate delivery ids.
  const isHuman = await verifyTurnstileToken(turnstileToken);
  if (!isHuman) {
    return NextResponse.json(
      { error: "Human verification failed. Please try again." },
      { status: 403 }
    );
  }

  // 4. Per-customer rate limit (10 edits/day).
  const { success } = await editRateLimit.limit(`edit:${verified.phone}`);
  if (!success) {
    return NextResponse.json(
      { error: "Too many edits. Try again later." },
      { status: 429 }
    );
  }

  // 5. Validate the new values structurally.
  if (newDate) {
    const d = parseDate(newDate);
    if (!d) {
      return NextResponse.json({ error: "Invalid new_date." }, { status: 400 });
    }
    // 24h floor on the new date (1s slack for clock skew).
    if (d.getTime() - Date.now() < MS_DAY - 1000) {
      return NextResponse.json(
        { error: "New date must be at least 24 hours away." },
        { status: 400 }
      );
    }
  }
  if (newSlot && !ALLOWED_TIME_SLOTS.has(newSlot)) {
    return NextResponse.json(
      { error: "Invalid time slot." },
      { status: 400 }
    );
  }

  // 6. Resolve delivery → subscription → customer and check ownership.
  const { data: delivery } = await supabaseAdmin
    .from("subscription_deliveries")
    .select(
      "id, subscription_id, scheduled_date, scheduled_time_slot, status, admin_notes"
    )
    .eq("id", params.deliveryId)
    .eq("subscription_id", params.id)
    .maybeSingle();
  if (!delivery) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("customer_id, status")
    .eq("id", params.id)
    .maybeSingle();
  if (!sub) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: cust } = await supabaseAdmin
    .from("customers")
    .select("phone")
    .eq("id", sub.customer_id)
    .maybeSingle();
  if (!cust || normalizePhone(cust.phone) !== verified.phone) {
    // Same shape as missing — don't leak existence to non-owners.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (sub.status !== "active") {
    return NextResponse.json(
      { error: "Subscription is not active." },
      { status: 400 }
    );
  }

  // 7. Status gate — only editable while pending_confirmation or confirmed.
  if (
    delivery.status !== "pending_confirmation" &&
    delivery.status !== "confirmed"
  ) {
    return NextResponse.json(
      { error: "This delivery can no longer be changed." },
      { status: 400 }
    );
  }

  // 8. 24h gate on the *current* delivery. Within 24h must use change-request.
  const scheduled = parseDate(delivery.scheduled_date);
  if (!scheduled || scheduled.getTime() - Date.now() < MS_DAY - 1000) {
    return NextResponse.json(
      {
        error:
          "Within 24 hours of delivery — please send a change request for admin approval.",
      },
      { status: 400 }
    );
  }

  // 9. Apply update + audit-trail line on admin_notes.
  const oldDate = delivery.scheduled_date;
  const oldSlot = delivery.scheduled_time_slot;
  const finalDate = newDate ?? oldDate;
  const finalSlot = newSlot ?? oldSlot;

  const stamp = new Date().toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const editLine = `[user edit ${stamp}] ${oldDate} ${oldSlot} → ${finalDate} ${finalSlot}`;
  const nextNotes = delivery.admin_notes
    ? `${delivery.admin_notes}\n${editLine}`
    : editLine;

  const update: Record<string, unknown> = {
    status_updated_at: new Date().toISOString(),
    admin_notes: nextNotes,
  };
  if (newDate) update.scheduled_date = newDate;
  if (newSlot) update.scheduled_time_slot = newSlot;

  const { data: updated, error: uErr } = await supabaseAdmin
    .from("subscription_deliveries")
    .update(update)
    .eq("id", params.deliveryId)
    .select("*")
    .single();
  if (uErr || !updated) {
    console.error("[edit delivery]", uErr);
    return NextResponse.json(
      { error: "Failed to update", details: uErr?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, delivery: updated });
}
