// Helpers shared by the /subscriptions/setup wizard, checkout, and payment
// pages. Pure functions + sessionStorage I/O — no React.

import { DAY_KEYS, type DayKey } from "./subscription-dates";

export type ProductSlug = "multigrain" | "plain";

/** Minimal product info we need in the wizard. Mirrors PRODUCTS in lib/data.ts. */
export const SETUP_PRODUCTS: Array<{
  slug: ProductSlug;
  name: string;
  title: string;
  price: number;
  blurb: string;
}> = [
  {
    slug: "multigrain",
    name: "Protein Bread Multigrain",
    title: "Multigrain",
    price: 140,
    blurb: "Ancient grains, seeds, whey protein.",
  },
  {
    slug: "plain",
    name: "Protein Bread Plain",
    title: "Plain",
    price: 110,
    blurb: "Soft sandwich slices, clean build.",
  },
];

/** 14 one-hour slots from 6 AM to 8 PM, e.g. "06:00-07:00". */
export const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = 6; h < 20; h++) {
    const a = String(h).padStart(2, "0");
    const b = String(h + 1).padStart(2, "0");
    out.push(`${a}:00-${b}:00`);
  }
  return out;
})();

/** Pretty 1-hour slot label, e.g. "06:00-07:00" → "6 – 7 AM". */
export function formatSlot(slot: string): string {
  const [a, b] = slot.split("-");
  const h1 = parseInt(a, 10);
  const h2 = parseInt(b, 10);
  const fmt = (h: number) => {
    const ampm = h < 12 ? "AM" : "PM";
    const hh = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return { hh, ampm };
  };
  const f1 = fmt(h1);
  const f2 = fmt(h2);
  // If both halves share AM/PM, drop the first label.
  if (f1.ampm === f2.ampm) return `${f1.hh} – ${f2.hh} ${f2.ampm}`;
  return `${f1.hh} ${f1.ampm} – ${f2.hh} ${f2.ampm}`;
}

/** ISO date "yyyy-mm-dd" from a Date (local, not UTC). */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Parse "yyyy-mm-dd" into a local Date at midnight. */
export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Mon=0..Sun=6 weekday index for a Date. */
export function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** Returns the Monday (00:00 local) of the calendar week containing d. */
export function mondayOf(d: Date): Date {
  const idx = mondayIndex(d);
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - idx);
  return out;
}

/** Day-key (mon..sun) for a Date. */
export function dayKeyOf(d: Date): DayKey {
  return DAY_KEYS[mondayIndex(d)];
}

/** Build the next N week-Monday ISOs starting from this calendar week. */
export function next13WeekMondays(today: Date, count = 13): string[] {
  const start = mondayOf(today);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i * 7);
    out.push(isoDate(d));
  }
  return out;
}

/** All seven day-Date objects (Mon..Sun) for a given week-Monday ISO. */
export function daysInWeek(weekMondayIso: string): Date[] {
  const mon = parseIso(weekMondayIso);
  const out: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    out.push(d);
  }
  return out;
}

/** Short label like "Mon 4". */
export function shortDayLabel(d: Date): string {
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric" });
}

/** "Mon 4 May" for review summary. */
export function longDayLabel(d: Date): string {
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

/** "May 4 – May 10" range for a week-Monday ISO. */
export function weekRangeLabel(weekMondayIso: string): string {
  const mon = parseIso(weekMondayIso);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return `${fmt(mon)} – ${fmt(sun)}`;
}

// ── sessionStorage keys ──────────────────────────────────────────────────

export const SETUP_KEY = "cadieux_setup_v1";
export const ADDRESS_KEY = "cadieux_setup_address_v1";

export type SetupState = {
  productSlug: ProductSlug | null;
  qty: number;                                 // 1..5
  weeksCount: number;                          // 1..12
  selectedWeeks: string[];                     // ISO Mondays
  daysByWeek: Record<string, string[]>;        // weekMondayIso -> ISO day dates
  slotByDate: Record<string, string>;          // ISO day date -> "06:00-07:00"
};

export function emptySetupState(): SetupState {
  return {
    productSlug: null,
    qty: 1,
    weeksCount: 1,
    selectedWeeks: [],
    daysByWeek: {},
    slotByDate: {},
  };
}

export function loadSetupState(): SetupState {
  if (typeof window === "undefined") return emptySetupState();
  try {
    const raw = sessionStorage.getItem(SETUP_KEY);
    if (!raw) return emptySetupState();
    const parsed = JSON.parse(raw) as Partial<SetupState>;
    return { ...emptySetupState(), ...parsed };
  } catch {
    return emptySetupState();
  }
}

export function saveSetupState(state: SetupState): void {
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(SETUP_KEY, JSON.stringify(state)); } catch { /* ignore quota */ }
}

export function clearSetupState(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SETUP_KEY);
    sessionStorage.removeItem(ADDRESS_KEY);
  } catch { /* ignore */ }
}

export type SetupAddress = {
  customer_id: string;
  full_name: string;
  phone: string;        // 10-digit
  address: string;
  city: string;
  pincode: string;
};

export function loadAddress(): SetupAddress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(ADDRESS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SetupAddress;
  } catch {
    return null;
  }
}

export function saveAddress(a: SetupAddress): void {
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(ADDRESS_KEY, JSON.stringify(a)); } catch { /* ignore */ }
}

// ── Delivery-list builder ────────────────────────────────────────────────

export type SetupDelivery = {
  sequence: number;
  week_number: number; // 1-based by chronological order of selectedWeeks
  day_key: DayKey;
  delivery_date: string; // yyyy-mm-dd
  slot: string;          // "06:00-07:00"
};

/** Flatten the wizard state into one row per (week, day) sorted chronologically. */
export function buildDeliveries(state: SetupState): SetupDelivery[] {
  const sortedWeeks = [...state.selectedWeeks].sort();
  const weekIndex: Record<string, number> = {};
  sortedWeeks.forEach((w, i) => { weekIndex[w] = i + 1; });

  const rows: SetupDelivery[] = [];
  for (const w of sortedWeeks) {
    const dayDates = state.daysByWeek[w] ?? [];
    for (const dIso of dayDates) {
      const slot = state.slotByDate[dIso];
      if (!slot) continue;
      rows.push({
        sequence: 0,
        week_number: weekIndex[w],
        day_key: dayKeyOf(parseIso(dIso)),
        delivery_date: dIso,
        slot,
      });
    }
  }
  rows.sort((a, b) => a.delivery_date.localeCompare(b.delivery_date));
  rows.forEach((r, i) => { r.sequence = i + 1; });
  return rows;
}

/** Combined list of every (week, day) row, regardless of slot-fill state. Used by Step 5. */
export function listWeekDayRows(state: SetupState): Array<{
  week_iso: string;
  week_number: number;
  date_iso: string;
  date: Date;
}> {
  const sortedWeeks = [...state.selectedWeeks].sort();
  const out: Array<{ week_iso: string; week_number: number; date_iso: string; date: Date }> = [];
  sortedWeeks.forEach((w, idx) => {
    const dayDates = [...(state.daysByWeek[w] ?? [])].sort();
    for (const dIso of dayDates) {
      out.push({
        week_iso: w,
        week_number: idx + 1,
        date_iso: dIso,
        date: parseIso(dIso),
      });
    }
  });
  return out;
}
