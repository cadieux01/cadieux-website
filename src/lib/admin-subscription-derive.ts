// Reusable derivations for the Subscriptions UI / analytics.
//
// `derived_end_date` mirrors the rule used in
// src/app/api/cron/subscription-reminders/route.ts:
//   MAX(subscription_deliveries.delivery_date)
//   fallback → created_at + total_weeks * 7d
//
// Keep both in sync: if the cron rule changes, this helper must
// change too (otherwise the "expiring in 7 days" filter will lie).

import { addDaysISO } from "@/lib/admin-formatting";

export type SubLite = {
  id: string;
  total_weeks: number | null;
  created_at: string;
};

export type DeliveryLite = {
  subscription_id: string;
  delivery_date: string;
  status: string | null;
  // Admin-editable copies. Present on both routes' projections; the
  // next-delivery pick prefers them, exactly like the UI does.
  scheduled_date?: string | null;
  scheduled_time_slot?: string | null;
  slot?: string | null;
  sequence?: number | null;
  week_number?: number | null;
};

/** The one delivery still owed: earliest non-terminal row, by date. */
export type NextDelivery = {
  date: string;
  slot: string | null;
  sequence: number | null;
  week_number: number | null;
  status: string | null;
};

export type DerivedSub = {
  derived_end_date: string | null;
  remaining_deliveries: number;
  // Count of ALL delivery rows for the sub (any status) — the honest
  // "N deliveries total" the plan sentence needs, never weeks × days.
  total_deliveries: number;
  // null once every delivery is delivered or cancelled.
  next_delivery: NextDelivery | null;
};

export function buildDerivations(
  subs: SubLite[],
  deliveries: DeliveryLite[],
): Map<string, DerivedSub> {
  const maxByDel = new Map<string, string>();
  const remainingBySub = new Map<string, number>();
  const totalBySub = new Map<string, number>();
  const nextBySub = new Map<string, NextDelivery>();
  for (const row of deliveries) {
    const sid = row.subscription_id;
    const cur = maxByDel.get(sid);
    if (!cur || row.delivery_date > cur) maxByDel.set(sid, row.delivery_date);
    totalBySub.set(sid, (totalBySub.get(sid) ?? 0) + 1);
    const isTerminal =
      row.status === "delivered" || row.status === "cancelled";
    if (!isTerminal) {
      remainingBySub.set(sid, (remainingBySub.get(sid) ?? 0) + 1);
      const date = row.scheduled_date ?? row.delivery_date;
      const best = nextBySub.get(sid);
      if (date && (!best || date < best.date)) {
        nextBySub.set(sid, {
          date,
          slot: row.scheduled_time_slot ?? row.slot ?? null,
          sequence: row.sequence ?? null,
          week_number: row.week_number ?? null,
          status: row.status,
        });
      }
    }
  }
  const out = new Map<string, DerivedSub>();
  for (const sub of subs) {
    let endDate = maxByDel.get(sub.id) ?? null;
    if (!endDate && sub.total_weeks && sub.total_weeks > 0) {
      const createdISO = sub.created_at.slice(0, 10);
      endDate = addDaysISO(createdISO, sub.total_weeks * 7);
    }
    out.set(sub.id, {
      derived_end_date: endDate,
      remaining_deliveries: remainingBySub.get(sub.id) ?? 0,
      total_deliveries: totalBySub.get(sub.id) ?? 0,
      next_delivery: nextBySub.get(sub.id) ?? null,
    });
  }
  return out;
}
