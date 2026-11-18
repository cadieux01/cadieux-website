// Pure date helpers for /mkt/calendar — kept out of the .tsx page so
// `node --test` can import them without a bundler. Mirrors the pattern
// src/lib/mkt-crm.ts uses (segment helpers + buildWeekBuckets).

export type CalendarView = "week" | "month";

/** Build an ISO YYYY-MM-DD string from a Date, in LOCAL time (IST
 *  here). Not UTC — a late-evening IST timestamp converted to UTC
 *  rolls into the next day and the calendar reads wrong at the right
 *  edge. */
export function toIsoLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD into a local-midnight Date. Returns null on bad
 *  input (bad calendar dates like Feb 30 → NaN → null). */
export function parseIsoLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() + 1 !== Number(m[2]) || d.getDate() !== Number(m[3])) {
    return null;
  }
  return d;
}

/** Add `n` days to a Date, returning a fresh Date in local time. */
export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Monday of the ISO week containing `d`. Mondays because IST business
 *  weeks run Mon–Sun and that is what the operator reads. */
export function startOfWeek(d: Date): Date {
  const out = new Date(d);
  const day = out.getDay(); // 0=Sun..6=Sat
  // Mon=0 ... Sun=6: subtract (day + 6) % 7 days.
  out.setDate(out.getDate() - ((day + 6) % 7));
  out.setHours(0, 0, 0, 0);
  return out;
}

/** First visible cell of the month view — Monday of the week that
 *  contains the first day of the month. The grid is always 6 weeks
 *  (42 cells) so the month view is a fixed shape regardless of how
 *  the days land. */
export function startOfMonthGrid(d: Date): Date {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  return startOfWeek(first);
}

/** 7 dates (Mon..Sun) starting at the week `d` belongs to. */
export function daysInWeek(d: Date): Date[] {
  const start = startOfWeek(d);
  const out: Date[] = [];
  for (let i = 0; i < 7; i++) out.push(addDays(start, i));
  return out;
}

/** 42 dates (6 weeks) for the month-grid view containing `d`. */
export function daysInMonthGrid(d: Date): Date[] {
  const start = startOfMonthGrid(d);
  const out: Date[] = [];
  for (let i = 0; i < 42; i++) out.push(addDays(start, i));
  return out;
}

/** Does this Date belong to the same calendar month as `ref`? */
export function sameMonth(d: Date, ref: Date): boolean {
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

/** True if iso1 is the same local calendar day as iso2. */
export function sameDay(iso1: string, iso2: string): boolean {
  return iso1 === iso2;
}

export type CalendarTask = {
  id: string;
  title: string;
  due_date: string | null;
  status: "todo" | "in_progress" | "done" | "blocked";
  team_id: string | null;
  assignee_id: string | null;
  progress: number;
  cadence: "one-off" | "daily" | "weekly" | "monthly";
};

export type CalendarCampaign = {
  id: string;
  name: string;
  status: "planned" | "active" | "paused" | "done" | "cancelled";
  starts_on: string;
  ends_on: string;
  team_id: string | null;
};

/** Is this task overdue relative to today? A task is overdue when its
 *  due_date is strictly before today's local date AND its status is
 *  not 'done'. The calendar paints these red. */
export function isOverdue(t: CalendarTask, today: string): boolean {
  if (!t.due_date) return false;
  if (t.status === "done") return false;
  return t.due_date < today;
}

/** Does this campaign cover `iso` (inclusive at both ends)? */
export function campaignCoversDay(c: CalendarCampaign, iso: string): boolean {
  return iso >= c.starts_on && iso <= c.ends_on;
}
