// Extracted from the pre-consolidation /api/cron/subscription-reminders route
// so the new /api/cron/daily-housekeeping runner can invoke it as one of three
// sequential phases, each wrapped in its own try/catch. Behaviour, thresholds,
// windows, and idempotency table remain exactly as the old route had them —
// this is a code move, not a rewrite.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Resend } from "resend";
import {
  buildReminder,
  type ReminderWindow,
} from "@/lib/email/subscription-reminders";

// ── IST helpers ─────────────────────────────────────────────────────────────

function istTodayISO(): string {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function formatHumanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = dt.toLocaleDateString("en-IN", {
    weekday: "short",
    timeZone: "UTC",
  });
  const day = dt.getUTCDate();
  const month = dt.toLocaleDateString("en-IN", {
    month: "short",
    timeZone: "UTC",
  });
  const year = dt.getUTCFullYear();
  return `${weekday}, ${day} ${month} ${year}`;
}

function buildWindowMap(): Record<string, ReminderWindow> {
  const today = istTodayISO();
  return {
    [addDaysISO(today, 7)]:  "7d_before",
    [addDaysISO(today, 3)]:  "3d_before",
    [addDaysISO(today, 1)]:  "1d_before",
    [today]:                 "expiry_day",
    [addDaysISO(today, -3)]: "3d_after",
  };
}

interface SubscriptionRow {
  id: string;
  bread_name: string | null;
  weeks: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  created_at: string;
  status: string;
}

export type RemindersPhaseResult = {
  sent: number;
  failed: number;
  skipped: number;
  /** Present only when the phase couldn't even start (e.g. DB read failed). */
  error?: string;
};

export async function runSubscriptionReminders(
  supabase: SupabaseClient,
  resend: Resend,
  fromEmail: string,
): Promise<RemindersPhaseResult> {
  const windows = buildWindowMap();
  const targetDates = Object.keys(windows);

  const { data: subs, error: subsErr } = await supabase
    .from("subscriptions")
    .select(
      "id, bread_name, weeks, customer_name, customer_phone, created_at, status",
    )
    .eq("status", "active");

  if (subsErr) {
    return { sent: 0, failed: 0, skipped: 0, error: subsErr.message };
  }

  const subscriptions = (subs || []) as SubscriptionRow[];
  if (subscriptions.length === 0) {
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const subIds = subscriptions.map((s) => s.id);
  const { data: deliveries, error: delErr } = await supabase
    .from("subscription_deliveries")
    .select("subscription_id, delivery_date")
    .in("subscription_id", subIds);

  if (delErr) {
    return { sent: 0, failed: 0, skipped: 0, error: delErr.message };
  }

  const maxByDel = new Map<string, string>();
  for (const row of (deliveries || []) as {
    subscription_id: string;
    delivery_date: string;
  }[]) {
    const cur = maxByDel.get(row.subscription_id);
    if (!cur || row.delivery_date > cur) {
      maxByDel.set(row.subscription_id, row.delivery_date);
    }
  }

  type Candidate = {
    sub: SubscriptionRow;
    endDate: string;
    window: ReminderWindow;
  };
  const candidates: Candidate[] = [];
  for (const sub of subscriptions) {
    let endDate = maxByDel.get(sub.id);
    if (!endDate) {
      if (!sub.weeks || sub.weeks <= 0) continue;
      const createdISO = sub.created_at.slice(0, 10);
      endDate = addDaysISO(createdISO, sub.weeks * 7);
    }
    const window = windows[endDate];
    if (!window) continue;
    candidates.push({ sub, endDate, window });
  }

  if (candidates.length === 0) {
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const { data: sentRows, error: sentErr } = await supabase
    .from("subscription_reminders_sent")
    .select("subscription_id, window")
    .in(
      "subscription_id",
      candidates.map((c) => c.sub.id),
    )
    .in(
      "window",
      targetDates.map((d) => windows[d]),
    );

  if (sentErr) {
    return { sent: 0, failed: 0, skipped: 0, error: sentErr.message };
  }

  const alreadySent = new Set<string>();
  for (const row of (sentRows || []) as {
    subscription_id: string;
    window: string;
  }[]) {
    alreadySent.add(`${row.subscription_id}|${row.window}`);
  }

  const phones = Array.from(
    new Set(
      candidates
        .map((c) => c.sub.customer_phone)
        .filter((p): p is string => !!p && p.length > 0),
    ),
  );

  const emailByPhone = new Map<
    string,
    { email: string; full_name: string | null }
  >();
  if (phones.length > 0) {
    const { data: customers, error: custErr } = await supabase
      .from("customers")
      .select("phone, email, full_name")
      .in("phone", phones);
    if (custErr) {
      return { sent: 0, failed: 0, skipped: 0, error: custErr.message };
    }
    for (const row of (customers || []) as {
      phone: string;
      email: string | null;
      full_name: string | null;
    }[]) {
      if (row.email && row.phone) {
        emailByPhone.set(row.phone, {
          email: row.email,
          full_name: row.full_name,
        });
      }
    }
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const c of candidates) {
    const key = `${c.sub.id}|${c.window}`;
    if (alreadySent.has(key)) {
      skipped++;
      continue;
    }
    const phone = c.sub.customer_phone || "";
    const cust = phone ? emailByPhone.get(phone) : undefined;
    if (!cust || !cust.email) {
      skipped++;
      continue;
    }

    const planName = c.sub.bread_name
      ? `${c.sub.bread_name}${c.sub.weeks ? ` (${c.sub.weeks} weeks)` : ""}`
      : "Cadieux subscription";

    const email = buildReminder(c.window, {
      firstName: (cust.full_name || c.sub.customer_name || "").trim(),
      planName,
      endDate: formatHumanDate(c.endDate),
    });

    try {
      const { error: sendErr } = await resend.emails.send({
        from: fromEmail,
        to: cust.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      if (sendErr) {
        failed++;
        continue;
      }
    } catch {
      failed++;
      continue;
    }

    const { error: insErr } = await supabase
      .from("subscription_reminders_sent")
      .insert({
        subscription_id: c.sub.id,
        window: c.window,
        email_to: cust.email,
      });
    if (insErr) {
      // Email went out but we couldn't record it. Count as sent — the unique
      // constraint prevents a duplicate on next run if the insert later
      // succeeds via retry.
      sent++;
      continue;
    }
    sent++;
  }

  return { sent, failed, skipped };
}
