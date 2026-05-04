// Schedule generator for the new subscription model:
// one delivery per week_number (1..total_weeks), on a single weekday,
// at a fixed time slot, every 1 or 2 weeks.

export const DOW_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DowKey = (typeof DOW_KEYS)[number];

export type Frequency = "weekly" | "bi-weekly";

export type ScheduledDelivery = {
  week_number: number;
  scheduled_date: string; // yyyy-mm-dd
};

/** Mon=0..Sun=6 (vs JS getDay's Sun=0..Sat=6). */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Generate `totalWeeks` delivery dates starting from the next occurrence of
 * `dayOfWeek` strictly after `from` (same-weekday-as-today pushes to next week).
 * Step by 7 days for weekly, 14 days for bi-weekly. week_number is 1..N.
 */
export function generateSchedule(
  from: Date,
  dayOfWeek: DowKey,
  frequency: Frequency,
  totalWeeks: number
): ScheduledDelivery[] {
  if (!totalWeeks || totalWeeks < 1) return [];
  const dayIdx = DOW_KEYS.indexOf(dayOfWeek);
  if (dayIdx < 0) return [];

  const fromIdx = mondayIndex(from);
  let delta = (dayIdx - fromIdx + 7) % 7;
  if (delta === 0) delta = 7; // same weekday as today → next week

  const anchor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const step = frequency === "bi-weekly" ? 14 : 7;

  const out: ScheduledDelivery[] = [];
  for (let w = 1; w <= totalWeeks; w++) {
    const d = new Date(anchor);
    d.setDate(anchor.getDate() + delta + (w - 1) * step);
    out.push({ week_number: w, scheduled_date: isoDate(d) });
  }
  return out;
}
