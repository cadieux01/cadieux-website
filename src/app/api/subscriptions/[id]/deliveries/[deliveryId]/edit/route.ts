// Customer self-edit for an upcoming delivery. Allowed only when the
// scheduled delivery slot is MORE than 14 hours away (per the unified
// delivery-slot rules) and the delivery is still pending_confirmation /
// confirmed. Within the 14 h cutoff the customer must call ADMIN_PHONE
// (UI surfaces the message; this route still 400s with self_edit_cutoff
// as a defense in depth).
//
// On a successful save we also re-validate the NEW slot against the
// 12 h 10 m booking rule via validateBookingSlot — a customer can't
// reschedule into the placement window.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getVerifiedPhone,
  normalizePhone,
  rollPhoneCookieOnWebRequest,
} from "@/lib/phone-cookie";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { editRateLimit } from "@/lib/ratelimit";
import {
  ADMIN_PHONE,
  SELF_EDIT_BLOCKED_MESSAGE,
  canSelfEdit,
  isValidSlotValue,
  validateBookingSlot,
} from "@/lib/delivery-slots";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

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

  // 5. Validate the new values structurally. The booking-lead check (the
  //    new slot must be ≥ 12 h 10 m out) runs after we read the delivery
  //    row, so we can validate both the date and the slot together.
  if (newDate) {
    const d = parseDate(newDate);
    if (!d) {
      return NextResponse.json({ error: "Invalid new_date." }, { status: 400 });
    }
  }
  if (newSlot && !isValidSlotValue(newSlot)) {
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

  // 8. 14 h self-edit gate on the *current* delivery. Within 14 h the
  //    customer must call ADMIN_PHONE — UI surfaces the message; this
  //    route 400s with self_edit_cutoff so the client can show the
  //    fallback even if the UI gate is bypassed.
  if (!canSelfEdit(delivery.scheduled_date, delivery.scheduled_time_slot)) {
    return NextResponse.json(
      {
        error: SELF_EDIT_BLOCKED_MESSAGE,
        code: "self_edit_cutoff",
        admin_phone: ADMIN_PHONE,
      },
      { status: 400 }
    );
  }

  // 9. Re-validate the NEW slot against the 12 h 10 m booking rule —
  //    a self-edit can't shove the delivery into the placement window.
  const oldDate = delivery.scheduled_date;
  const oldSlot = delivery.scheduled_time_slot;
  const finalDate = newDate ?? oldDate;
  const finalSlot = newSlot ?? oldSlot;
  if (finalSlot) {
    const gate = validateBookingSlot(finalDate, finalSlot);
    if (gate) {
      return NextResponse.json(
        { error: gate.error, code: gate.code },
        { status: gate.status }
      );
    }
  }

  // 10. Apply update + audit-trail line on admin_notes.

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

  const res = NextResponse.json({ ok: true, delivery: updated });
  rollPhoneCookieOnWebRequest(req, res);
  return res;
}
