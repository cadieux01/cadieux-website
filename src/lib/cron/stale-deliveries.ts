// Stale-deliveries surface phase.
//
// PURPOSE
// A subscription_deliveries row that is more than 7 days past its
// delivery_date and still not in a terminal state (delivered / cancelled),
// while its parent subscription is NOT cancelled, is stuck. Historically
// these went unnoticed because nobody sweeps them — the admin board only
// filters by parent status. This phase surfaces them into the daily
// housekeeping response and into the evening bake-plan email so the human
// operator sees them once a day.
//
// WE DO NOT AUTO-RESOLVE. The database does not know whether the loaf
// went to the customer; only Sunny does. Marking these "delivered" would
// invent a fact; marking them "cancelled" (unless the parent is already
// cancelled — that lives in the cancel routes) would deny a delivery that
// might have actually happened. So this phase is READ-ONLY: it just lists.
//
// Parent-status filter: `s.status <> 'cancelled'` — a delivery whose parent
// is cancelled belongs to the cascade path, not to this list. Anything the
// cascade misses is a bug in the cascade, surfaced separately.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface StaleDeliveryRow {
  delivery_id: string;
  subscription_id: string;
  subscription_number: string | null;
  /** Booking-time snapshot from `subscriptions.customer_name` — NOT the
   *  joined `customers.full_name`. A later order on a shared phone rewrites
   *  the customers row and would retroactively relabel every past
   *  subscription on that customer_id. Trust only the snapshot. */
  customer_name: string | null;
  /** Booking-time snapshot from `subscriptions.customer_phone`. Same
   *  reasoning — the customers row is not the source of truth here. */
  customer_phone: string | null;
  delivery_date: string; // YYYY-MM-DD
  delivery_status: string;
  parent_status: string;
  days_overdue: number;
}

export type StaleDeliveriesResult = {
  count: number;
  rows: StaleDeliveryRow[];
  /** Present only when the phase couldn't even start (e.g. DB read failed). */
  error?: string;
};

/** Anything older than this (in days) is flagged. Matches the threshold
 *  the operator uses when eyeballing the admin board. */
const STALE_DAYS = 7;

/** ISO date `YYYY-MM-DD` for today in IST — the phase runs at 03:30 UTC
 *  (09:00 IST) so we deliberately anchor to IST calendar day, not UTC. */
function istTodayISO(): string {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysBetween(todayIso: string, dateIso: string): number {
  const [ty, tm, td] = todayIso.split("-").map(Number);
  const [dy, dm, dd] = dateIso.split("-").map(Number);
  const t = Date.UTC(ty, tm - 1, td);
  const x = Date.UTC(dy, dm - 1, dd);
  return Math.floor((t - x) / (24 * 60 * 60 * 1000));
}

/**
 * Load unresolved stale deliveries. Reusable from BOTH:
 *   - /api/cron/daily-housekeeping (as a phase — surfaces in the JSON body)
 *   - /api/cron/delivery-bake-plan (rendered as a section in the email)
 * Same rule, same threshold, one place to change either.
 */
export async function loadStaleDeliveries(
  supabase: SupabaseClient,
): Promise<StaleDeliveriesResult> {
  const today = istTodayISO();
  // Cutoff: delivery_date < today - 7 days.
  const [y, m, d] = today.split("-").map(Number);
  const cutoffMs = Date.UTC(y, m - 1, d) - STALE_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = new Date(cutoffMs);
  const cutoffIso = `${cutoff.getUTCFullYear()}-${String(
    cutoff.getUTCMonth() + 1,
  ).padStart(2, "0")}-${String(cutoff.getUTCDate()).padStart(2, "0")}`;

  const { data, error } = await supabase
    .from("subscription_deliveries")
    .select(
      "id, subscription_id, delivery_date, status, subscriptions!inner(subscription_number, customer_name, customer_phone, status)",
    )
    .lt("delivery_date", cutoffIso)
    .not("status", "in", "(delivered,cancelled)")
    .neq("subscriptions.status", "cancelled")
    .order("delivery_date", { ascending: true });

  if (error) {
    return { count: 0, rows: [], error: error.message };
  }

  type Row = {
    id: string;
    subscription_id: string;
    delivery_date: string;
    status: string;
    subscriptions: {
      subscription_number: string | null;
      customer_name: string | null;
      customer_phone: string | null;
      status: string;
    } | null;
  };

  const rows: StaleDeliveryRow[] = ((data || []) as unknown as Row[]).map(
    (r) => ({
      delivery_id: r.id,
      subscription_id: r.subscription_id,
      subscription_number: r.subscriptions?.subscription_number ?? null,
      customer_name: r.subscriptions?.customer_name ?? null,
      customer_phone: r.subscriptions?.customer_phone ?? null,
      delivery_date: r.delivery_date,
      delivery_status: r.status,
      parent_status: r.subscriptions?.status ?? "unknown",
      days_overdue: daysBetween(today, r.delivery_date),
    }),
  );

  return { count: rows.length, rows };
}
