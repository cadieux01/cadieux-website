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
  if (f1.ampm === f2.ampm) return `${f1.hh} – ${f2.hh} ${f2.ampm}`;
  return `${f1.hh} ${f1.ampm} – ${f2.hh} ${f2.ampm}`;
}

// ── Date primitives ──────────────────────────────────────────────────────

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

/** Returns the Sunday (00:00 local) of the calendar week containing d.
 *  Used by buildDeliveries() to derive a stable week_number per row. */
export function sundayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - out.getDay());
  return out;
}

/** Day-key (mon..sun) for a Date. */
export function dayKeyOf(d: Date): DayKey {
  return DAY_KEYS[mondayIndex(d)];
}

/** "Mon 4 May" for review summary. */
export function longDayLabel(d: Date): string {
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

// ── sessionStorage keys + state ──────────────────────────────────────────

// v3: collapsed wizard down to a single date-picker step. Old shape stored
// (selectedWeeks, daysByWeek) is migrated transparently on first load.
export const SETUP_KEY = "cadieux_setup_v3";
const LEGACY_V2_KEY = "cadieux_setup_v2";
const LEGACY_V1_KEY = "cadieux_setup_v1";
export const ADDRESS_KEY = "cadieux_setup_address_v1";

export type SetupState = {
  productSlug: ProductSlug | null;
  qty: number;                                // 1..5
  selectedDates: string[];                    // ISO dates, sorted ascending
  slotByDate: Record<string, string>;         // ISO date -> "06:00-07:00"
};

export function emptySetupState(): SetupState {
  return {
    productSlug: null,
    qty: 1,
    selectedDates: [],
    slotByDate: {},
  };
}

type LegacyV2 = {
  productSlug?: ProductSlug | null;
  qty?: number;
  daysByWeek?: Record<string, string[]>;
  slotByDate?: Record<string, string>;
};

/** Flatten the old { weekIso → [dayIso,...] } map into a sorted, deduped list. */
function migrateFromV2(legacy: LegacyV2): SetupState {
  const dates = Object.values(legacy.daysByWeek ?? {}).flat();
  const sorted = Array.from(new Set(dates)).sort();
  return {
    productSlug: legacy.productSlug ?? null,
    qty: legacy.qty ?? 1,
    selectedDates: sorted,
    slotByDate: legacy.slotByDate ?? {},
  };
}

export function loadSetupState(): SetupState {
  if (typeof window === "undefined") return emptySetupState();
  try {
    const raw = sessionStorage.getItem(SETUP_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SetupState>;
      return { ...emptySetupState(), ...parsed };
    }
    // Try migrating from older shapes so an in-progress user doesn't lose
    // their work across a deploy boundary.
    const legacyRaw =
      sessionStorage.getItem(LEGACY_V2_KEY) ?? sessionStorage.getItem(LEGACY_V1_KEY);
    if (legacyRaw) {
      const migrated = migrateFromV2(JSON.parse(legacyRaw) as LegacyV2);
      try {
        sessionStorage.setItem(SETUP_KEY, JSON.stringify(migrated));
        sessionStorage.removeItem(LEGACY_V2_KEY);
        sessionStorage.removeItem(LEGACY_V1_KEY);
      } catch { /* ignore */ }
      return migrated;
    }
  } catch { /* ignore */ }
  return emptySetupState();
}

export function saveSetupState(state: SetupState): void {
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(SETUP_KEY, JSON.stringify(state)); } catch { /* ignore quota */ }
}

export function clearSetupState(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SETUP_KEY);
    sessionStorage.removeItem(LEGACY_V2_KEY);
    sessionStorage.removeItem(LEGACY_V1_KEY);
    sessionStorage.removeItem(ADDRESS_KEY);
  } catch { /* ignore */ }
}

// ── Address (unchanged) ──────────────────────────────────────────────────

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
  week_number: number;   // 1-based by Sunday-of-week, derived from selectedDates
  day_key: DayKey;
  delivery_date: string; // yyyy-mm-dd
  slot: string;          // "06:00-07:00"
};

/** Group selected dates by their Sunday-of-week to assign a stable, 1-based
 *  week_number. Earliest week → 1. */
function weekNumberMap(dates: string[]): Record<string, number> {
  const sundayKeyByDate: Record<string, string> = {};
  const weekKeys = new Set<string>();
  for (const iso of dates) {
    const wk = isoDate(sundayOf(parseIso(iso)));
    sundayKeyByDate[iso] = wk;
    weekKeys.add(wk);
  }
  const ordered = Array.from(weekKeys).sort();
  const out: Record<string, number> = {};
  for (const iso of dates) {
    const wk = sundayKeyByDate[iso];
    out[iso] = ordered.indexOf(wk) + 1;
  }
  return out;
}

/** Flatten the wizard state into one row per date, sorted chronologically. */
export function buildDeliveries(state: SetupState): SetupDelivery[] {
  const dates = [...state.selectedDates].sort();
  const weekByDate = weekNumberMap(dates);
  const rows: SetupDelivery[] = [];
  dates.forEach((iso) => {
    const slot = state.slotByDate[iso];
    if (!slot) return;
    rows.push({
      sequence: 0,
      week_number: weekByDate[iso] ?? 1,
      day_key: dayKeyOf(parseIso(iso)),
      delivery_date: iso,
      slot,
    });
  });
  rows.forEach((r, i) => { r.sequence = i + 1; });
  return rows;
}

/** Combined list of every selected date, regardless of slot-fill state.
 *  Used by the time-slot picker step. */
export function listWeekDayRows(state: SetupState): Array<{
  week_iso: string;
  week_number: number;
  date_iso: string;
  date: Date;
}> {
  const dates = [...state.selectedDates].sort();
  const weekByDate = weekNumberMap(dates);
  return dates.map((iso) => {
    const date = parseIso(iso);
    return {
      week_iso: isoDate(sundayOf(date)),
      week_number: weekByDate[iso] ?? 1,
      date_iso: iso,
      date,
    };
  });
}
