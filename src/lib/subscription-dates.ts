export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

/** Mon=0 .. Sun=6 weekday from a Date object (JS getDay: Sun=0..Sat=6). */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export type GeneratedDelivery = {
  sequence: number;
  week_number: number;
  day_key: DayKey;
  delivery_date: Date;
};

/**
 * Generate concrete delivery dates for a subscription.
 * Week-1 rule: a chosen day delivers this calendar week iff its weekday
 * index > orderDate's weekday index; otherwise it slips to next week.
 * Subsequent weeks step by 7 days from each week-1 anchor.
 *
 * Returns one entry per (week × day), sorted by date ascending then by
 * the user's day order. The `sequence` field is 1-based.
 */
export function generateDeliveries(
  orderDate: Date,
  days: DayKey[],
  weeks: number,
): GeneratedDelivery[] {
  if (!days?.length || !weeks || weeks < 1) return [];

  const orderIdx = mondayIndex(orderDate);
  // Anchor at midnight to avoid time-of-day drift across day-additions.
  const anchor = new Date(orderDate.getFullYear(), orderDate.getMonth(), orderDate.getDate());

  const out: GeneratedDelivery[] = [];

  for (const dayKey of days) {
    const dayIdx = DAY_KEYS.indexOf(dayKey);
    if (dayIdx < 0) continue;

    let delta = (dayIdx - orderIdx + 7) % 7;
    if (delta === 0) delta = 7; // same weekday as order pushes to next week

    for (let w = 1; w <= weeks; w++) {
      const date = new Date(anchor);
      date.setDate(anchor.getDate() + delta + (w - 1) * 7);
      out.push({
        sequence: 0, // assigned after sort
        week_number: w,
        day_key: dayKey,
        delivery_date: date,
      });
    }
  }

  // Sort chronologically; for ties (shouldn't happen) keep stable by week+day order.
  out.sort((a, b) => {
    const t = a.delivery_date.getTime() - b.delivery_date.getTime();
    if (t !== 0) return t;
    if (a.week_number !== b.week_number) return a.week_number - b.week_number;
    return DAY_KEYS.indexOf(a.day_key) - DAY_KEYS.indexOf(b.day_key);
  });

  out.forEach((d, i) => { d.sequence = i + 1; });
  return out;
}
