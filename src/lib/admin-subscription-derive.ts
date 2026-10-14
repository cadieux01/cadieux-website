// Reusable derivations for the Subscriptions UI / analytics.
//
// `derived_end_date` is NOT mirrored here any more — it is imported.
// The rule, the choice of week column and the reasoning all live in
// src/lib/subscription-end-date.ts, which the subscription-reminder cron
// calls too, so the board's "expiring in 7 days" filter and the
// "your plan is ending" email cannot disagree about the same plan.
//
// This comment used to point at src/app/api/cron/subscription-reminders/
// route.ts and say "keep both in sync". That file was DELETED in 20aa908
// when the crons were consolidated behind a registry, so the only
// instruction tying the two copies together had been aimed at nothing for
// as long as there were two copies. The live phase module is
// src/lib/cron/subscription-reminders-phase.ts (run by
// /api/cron/daily-housekeeping) — and now there is nothing to keep in
// sync, which is the better fix than a corrected pointer.

import {
  effectiveDeliveryDate,
  resolveEndDate,
} from "@/lib/subscription-end-date";

export type SubLite = {
  id: string;
  /** Authoritative week count. Optional because a caller may project only
   *  the `total_weeks` mirror; see planWeeks() for the precedence. */
  weeks?: number | null;
  total_weeks?: number | null;
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
  // Count of delivery rows whose status is 'delivered'. Kept as its own
  // field (rather than derived from total minus remaining) because
  // `remaining` groups cancelled with delivered under "terminal", and a
  // subscription with 4 delivered + 1 cancelled is NOT the same thing as
  // one with 5 delivered — the tick + ratio need the second count.
  delivered_deliveries: number;
  // null once every delivery is delivered or cancelled.
  next_delivery: NextDelivery | null;
  // EVERY still-meaningful delivery date on the plan (cancelled rows
  // excluded), as IST calendar dates, ascending and de-duplicated.
  //
  // This is what the subscriptions board's day filter matches against.
  // It cannot be `next_delivery` alone: a plan delivering on the 18th and
  // the 20th has a next_delivery of the 18th, and matching on that would
  // make it vanish from a board showing the 20th — the plan would be
  // baked for, but not listed. Delivered rows STAY in the set so an
  // operator looking back at yesterday still sees who was served.
  delivery_dates: string[];
};

export function buildDerivations(
  subs: SubLite[],
  deliveries: DeliveryLite[],
): Map<string, DerivedSub> {
  const maxByDel = new Map<string, string>();
  const remainingBySub = new Map<string, number>();
  const totalBySub = new Map<string, number>();
  const deliveredBySub = new Map<string, number>();
  const nextBySub = new Map<string, NextDelivery>();
  const datesBySub = new Map<string, Set<string>>();
  for (const row of deliveries) {
    const sid = row.subscription_id;
    // effectiveDeliveryDate, NOT the raw delivery_date. This accumulator
    // used to read the raw column while every other date in this function
    // honoured `scheduled_date ?? delivery_date` — a file that contradicted
    // its own stated rule eight lines further down. OLS36 is the live case:
    // a stop moved from 2026-09-23 to 2026-09-21 left derived_end_date two
    // days late, so the plan showed as running after it had finished.
    const eff = effectiveDeliveryDate(row);
    const cur = maxByDel.get(sid);
    if (eff && (!cur || eff > cur)) maxByDel.set(sid, eff);
    totalBySub.set(sid, (totalBySub.get(sid) ?? 0) + 1);
    if (row.status !== "cancelled" && eff) {
      let set = datesBySub.get(sid);
      if (!set) datesBySub.set(sid, (set = new Set()));
      set.add(eff);
    }
    if (row.status === "delivered") {
      deliveredBySub.set(sid, (deliveredBySub.get(sid) ?? 0) + 1);
    }
    const isTerminal =
      row.status === "delivered" || row.status === "cancelled";
    if (!isTerminal) {
      remainingBySub.set(sid, (remainingBySub.get(sid) ?? 0) + 1);
      const best = nextBySub.get(sid);
      if (eff && (!best || eff < best.date)) {
        nextBySub.set(sid, {
          date: eff,
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
    out.set(sub.id, {
      derived_end_date: resolveEndDate(sub, maxByDel.get(sub.id) ?? null),
      remaining_deliveries: remainingBySub.get(sub.id) ?? 0,
      total_deliveries: totalBySub.get(sub.id) ?? 0,
      delivered_deliveries: deliveredBySub.get(sub.id) ?? 0,
      next_delivery: nextBySub.get(sub.id) ?? null,
      delivery_dates: Array.from(datesBySub.get(sub.id) ?? []).sort(),
    });
  }
  return out;
}
