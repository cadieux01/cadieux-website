// GET /api/cron/subscription-reminders
//
// Vercel Cron entry point. Runs daily at 03:30 UTC (09:00 IST). See vercel.json.
//
// Auth: Bearer ${CRON_SECRET}. Vercel Cron automatically sets this header
// when the cron has a matching secret configured; we also accept manual curl
// calls with the same header for testing.
//
// What it does:
//   1. Computes 5 IST date windows relative to "today" in Asia/Kolkata:
//        7d_before  → end_date = today + 7
//        3d_before  → end_date = today + 3
//        1d_before  → end_date = today + 1
//        expiry_day → end_date = today
//        3d_after   → end_date = today - 3
//   2. Derives each subscription's end_date as MAX(delivery_date) from
//      subscription_deliveries, falling back to created_at + (weeks * 7 days)
//      when no deliveries exist.
//   3. Joins customer email via customers.phone = subscriptions.customer_phone.
//   4. Skips subscriptions already reminded for that (subscription_id, window)
//      by consulting the subscription_reminders_sent table.
//   5. Sends each email via Resend; on success inserts an idempotency row.
//
// Response shape: { sent: number, failed: number, skipped: number }.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import {
  buildReminder,
  type ReminderWindow,
} from "@/lib/email/subscription-reminders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Cap at 60s — Vercel hobby tier limit. Plenty for daily reminder volumes.
export const maxDuration = 60;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || "Cadieux <hello@cadieux.in>";

// ── IST helpers ─────────────────────────────────────────────────────────────

// Return today's date in IST as YYYY-MM-DD.
function istTodayISO(): string {
  const now = new Date();
  // IST is UTC+5:30, no DST. Shift by 330 min then read UTC date parts.
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Add `days` to a YYYY-MM-DD date and return YYYY-MM-DD.
function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// Pretty-print a YYYY-MM-DD as "Mon, 23 Jun 2026" (IST-neutral; date-only).
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

// Compute the 5 window targets keyed by their end_date ISO.
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

// ── Types ───────────────────────────────────────────────────────────────────

interface SubscriptionRow {
  id: string;
  bread_name: string | null;
  weeks: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  created_at: string;
  status: string;
}

interface DeliveryMaxRow {
  subscription_id: string;
  max_delivery_date: string; // YYYY-MM-DD
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // A missing CRON_SECRET and a wrong Authorization header are two different
  // problems and must not produce the same response. Collapsed into one 401,
  // a cron that has been silently dead since it shipped is indistinguishable
  // in the logs from someone probing the endpoint.
  //   500 = our configuration is broken, nobody is getting these reminders.
  //   401 = config is fine, that caller just isn't authorised.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(
      "[cron/subscription-reminders] CRON_SECRET is not set — this cron cannot run.",
    );
    return NextResponse.json(
      { error: "cron secret not configured" },
      { status: 500 },
    );
  }

  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: "RESEND_API_KEY not configured" },
      { status: 500 },
    );
  }

  const resend = new Resend(process.env.RESEND_API_KEY);

  const windows = buildWindowMap();
  const targetDates = Object.keys(windows);

  // Fetch all active subscriptions. Volume is small enough that a single
  // pull and in-memory end-date derivation is cheaper than a complex SQL view.
  const { data: subs, error: subsErr } = await supabaseAdmin
    .from("subscriptions")
    .select("id, bread_name, weeks, customer_name, customer_phone, created_at, status")
    .eq("status", "active");

  if (subsErr) {
    return NextResponse.json({ error: subsErr.message }, { status: 500 });
  }

  const subscriptions = (subs || []) as SubscriptionRow[];
  if (subscriptions.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0, skipped: 0 });
  }

  // Pull MAX(delivery_date) per subscription in one query.
  const subIds = subscriptions.map((s) => s.id);
  const { data: deliveries, error: delErr } = await supabaseAdmin
    .from("subscription_deliveries")
    .select("subscription_id, delivery_date")
    .in("subscription_id", subIds);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  const maxByDel = new Map<string, string>();
  for (const row of (deliveries || []) as { subscription_id: string; delivery_date: string }[]) {
    const cur = maxByDel.get(row.subscription_id);
    if (!cur || row.delivery_date > cur) {
      maxByDel.set(row.subscription_id, row.delivery_date);
    }
  }

  // Match each subscription to a reminder window (if any).
  type Candidate = {
    sub: SubscriptionRow;
    endDate: string;
    window: ReminderWindow;
  };
  const candidates: Candidate[] = [];
  for (const sub of subscriptions) {
    let endDate = maxByDel.get(sub.id);
    if (!endDate) {
      // Fallback: derive from created_at + weeks*7
      if (!sub.weeks || sub.weeks <= 0) continue;
      const createdISO = sub.created_at.slice(0, 10);
      endDate = addDaysISO(createdISO, sub.weeks * 7);
    }
    const window = windows[endDate];
    if (!window) continue;
    candidates.push({ sub, endDate, window });
  }

  if (candidates.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0, skipped: 0 });
  }

  // Filter out already-sent (subscription_id, window) pairs.
  const { data: sentRows, error: sentErr } = await supabaseAdmin
    .from("subscription_reminders_sent")
    .select("subscription_id, window")
    .in("subscription_id", candidates.map((c) => c.sub.id))
    .in("window", targetDates.map((d) => windows[d]));

  if (sentErr) {
    return NextResponse.json({ error: sentErr.message }, { status: 500 });
  }

  const alreadySent = new Set<string>();
  for (const row of (sentRows || []) as { subscription_id: string; window: string }[]) {
    alreadySent.add(`${row.subscription_id}|${row.window}`);
  }

  // Resolve customer emails by phone.
  const phones = Array.from(
    new Set(
      candidates
        .map((c) => c.sub.customer_phone)
        .filter((p): p is string => !!p && p.length > 0),
    ),
  );

  const emailByPhone = new Map<string, { email: string; full_name: string | null }>();
  if (phones.length > 0) {
    const { data: customers, error: custErr } = await supabaseAdmin
      .from("customers")
      .select("phone, email, full_name")
      .in("phone", phones);
    if (custErr) {
      return NextResponse.json({ error: custErr.message }, { status: 500 });
    }
    for (const row of (customers || []) as { phone: string; email: string | null; full_name: string | null }[]) {
      if (row.email && row.phone) {
        emailByPhone.set(row.phone, { email: row.email, full_name: row.full_name });
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
      // No email on file — silently skip (cannot reach them).
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
        from: FROM_EMAIL,
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

    const { error: insErr } = await supabaseAdmin
      .from("subscription_reminders_sent")
      .insert({
        subscription_id: c.sub.id,
        window: c.window,
        email_to: cust.email,
      });
    if (insErr) {
      // Email went out but we couldn't record it. Count as sent — the unique
      // constraint will prevent a duplicate on next run if the insert later
      // succeeds via retry.
      sent++;
      continue;
    }
    sent++;
  }

  return NextResponse.json({ sent, failed, skipped });
}
