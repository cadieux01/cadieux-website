// Orphaned-payments surface phase.
//
// PURPOSE
// A subscription at payment_status='paid_orphaned' is one where Razorpay
// captured the customer's money AFTER the sweeper had already written the row
// off as 'abandoned'. The money is real and we are holding it; the deliveries
// are cancelled and nothing is scheduled. Only Sunny can decide whether that
// becomes a refund or a restart on fresh dates.
//
// WHY THIS PHASE EXISTS AT ALL
// The orphan branch in @/lib/subscription-payment already emails the owner the
// moment it happens. That email is a DOORBELL, not a record — Resend has bad
// days, and the alert fires from a request path where a frozen lambda can eat
// it. If the doorbell were the only mechanism, a single failed send would put
// us right back at "Razorpay holds money and nobody knows", which is the entire
// thing this work exists to prevent.
//
// So there are three independent surfaces, in decreasing order of durability:
//   1. the row itself, visible on the admin subscriptions board (permanent)
//   2. this phase, re-reporting every unresolved orphan once a day (recurring)
//   3. the alert email at the moment of the event (immediate, least reliable)
// Losing any one of the three still leaves the money discoverable.
//
// WE DO NOT AUTO-RESOLVE — same rule as the stale-deliveries phase, and for a
// sharper reason. Reinstating the deliveries would manufacture bake commitments
// on dates that have very likely already passed; auto-refunding would return a
// customer's money without anyone asking whether they would rather have their
// bread. Both are Sunny's call. This phase is READ-ONLY: it lists.
//
// An orphan leaves this list by being resolved into some other payment_status
// (refunded, or paid once reinstated). Nothing here writes.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface OrphanedPaymentRow {
  subscription_id: string;
  subscription_number: string | null;
  /** Booking-time snapshot from `subscriptions.customer_name` — NOT the
   *  joined `customers.full_name`. A later order on a shared phone rewrites
   *  the customers row and would retroactively relabel this. */
  customer_name: string | null;
  /** Booking-time snapshot from `subscriptions.customer_phone`. Sunny calls
   *  this number to make the refund-or-restart decision with the customer. */
  customer_phone: string | null;
  /** Rupees we are holding. */
  total_amount: number | null;
  razorpay_payment_id: string | null;
  /** When Razorpay captured — i.e. when the money actually became ours. */
  paid_at: string | null;
  /** How long the customer has been waiting for someone to call them. */
  days_waiting: number;
}

export type OrphanedPaymentsResult = {
  count: number;
  /** Total rupees held across every unresolved orphan. */
  totalHeldInr: number;
  rows: OrphanedPaymentRow[];
  /** Present only when the phase couldn't even start (e.g. DB read failed). */
  error?: string;
};

/** Cap per run so a bad week cannot blow the route's 60s budget. */
const LIMIT = 200;

function daysSince(iso: string | null): number {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000)));
}

/**
 * Load every unresolved orphaned payment, oldest first.
 *
 * Oldest-first is deliberate: if the list is ever truncated by LIMIT, the rows
 * that get dropped should be the ones that arrived most recently, not the
 * customer who has been waiting longest for a call.
 */
export async function loadOrphanedPayments(
  supabase: SupabaseClient,
): Promise<OrphanedPaymentsResult> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "id, subscription_number, customer_name, customer_phone, total_amount, razorpay_payment_id, paid_at",
    )
    .eq("payment_status", "paid_orphaned")
    .order("paid_at", { ascending: true })
    .limit(LIMIT);

  if (error) {
    return { count: 0, totalHeldInr: 0, rows: [], error: error.message };
  }

  const rows: OrphanedPaymentRow[] = (data || []).map((r) => ({
    subscription_id: r.id as string,
    subscription_number: r.subscription_number ?? null,
    customer_name: r.customer_name ?? null,
    customer_phone: r.customer_phone ?? null,
    total_amount: r.total_amount === null ? null : Number(r.total_amount),
    razorpay_payment_id: r.razorpay_payment_id ?? null,
    paid_at: r.paid_at ?? null,
    days_waiting: daysSince(r.paid_at ?? null),
  }));

  const totalHeldInr = rows.reduce((sum, r) => sum + (r.total_amount ?? 0), 0);

  if (rows.length > 0) {
    console.warn(
      `[cron/daily-housekeeping:orphaned] ${rows.length} unresolved orphaned payment(s), ₹${totalHeldInr} held`,
    );
  }

  return { count: rows.length, totalHeldInr, rows };
}
