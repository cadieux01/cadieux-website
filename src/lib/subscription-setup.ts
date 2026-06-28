// Helpers shared by the /subscriptions/setup wizard, checkout, and payment
// pages. Pure functions + sessionStorage I/O — no React.

import { DAY_KEYS, type DayKey } from "./subscription-dates";
import { SLOTS, formatSlotForDisplay } from "./delivery-slots";

export type ProductSlug = "multigrain" | "high-protein";

export type WizardProduct = {
  slug: ProductSlug;
  name: string;
  title: string;
  price: number;
  blurb: string;
};

/** Hardcoded wizard catalogue used as a NETWORK-FAILURE FALLBACK.
 *
 *  The wizard prefers the live values from GET /api/subscription-plans
 *  (which reads `subscription_per_loaf_inr` from the products table), so
 *  price/name edits in /admin/products show up without a redeploy. This
 *  constant is only consulted when the fetch fails or is still in flight.
 *
 *  The server-side checkout (/api/checkout?action=place_subscription)
 *  always re-validates against the DB, so a stale fallback price would
 *  surface as a `price_mismatch` error rather than an undercharge.
 *
 *  `title` and `blurb` are wizard-only display strings (shorter than the
 *  catalogue name, with brand copy). The public API reuses these by
 *  slug — adding a new slug here is required for the wizard to surface
 *  that product even after it lands in the DB. */
export const SETUP_PRODUCTS: WizardProduct[] = [
  {
    slug: "multigrain",
    name: "Protein Bread — Multigrain",
    title: "Multigrain",
    price: 135,
    blurb: "Ancient grains, seeds, whey protein.",
  },
  {
    slug: "high-protein",
    name: "Protein Bread — Plain",
    title: "Plain",
    price: 99,
    blurb: "Soft sandwich slices, clean build.",
  },
];

/** Fetch the live wizard catalogue from /api/subscription-plans, merging
 *  DB-driven prices over the SETUP_PRODUCTS fallback. On any error (offline,
 *  500, malformed JSON, empty list) returns SETUP_PRODUCTS unchanged so the
 *  wizard always has something to render.
 *
 *  Call from a useEffect on the client; the response is HTTP-cached and
 *  the underlying Supabase query is server-cached (60s, tag-busted on
 *  admin product writes). */
export async function fetchSubscriptionPlans(): Promise<WizardProduct[]> {
  try {
    const r = await fetch("/api/subscription-plans", { cache: "no-store" });
    if (!r.ok) return SETUP_PRODUCTS;
    const data = (await r.json()) as { plans?: WizardProduct[] };
    if (!Array.isArray(data.plans) || data.plans.length === 0) return SETUP_PRODUCTS;
    // Merge: for each fallback slug, prefer the live row if present, else
    // keep the fallback. Preserves order from SETUP_PRODUCTS so the picker
    // layout is stable when the API briefly returns a subset.
    const bySlug = new Map(data.plans.map((p) => [p.slug, p]));
    return SETUP_PRODUCTS.map((fb) => bySlug.get(fb.slug) ?? fb);
  } catch {
    return SETUP_PRODUCTS;
  }
}

/** Canonical 30-minute slot START values ("HH:MM"). 25 entries:
 *  07:30, …, 12:30, 14:00, …, 20:30 (kitchen lunch 1–2 PM excluded).
 *  The previous "HH:MM-HH:MM" 1-hour windows are still rendered correctly
 *  by `formatSlot()` for legacy rows. */
export const TIME_SLOTS: string[] = SLOTS.map((s) => s.value);

/** Pretty label for ANY stored slot value:
 *    - New "HH:MM"          → "7:30 AM"
 *    - Legacy "HH:MM-HH:MM" → "6 – 7 AM"   (preserved for legacy rows)
 *  Delegates to the unified `formatSlotForDisplay` in delivery-slots.ts. */
export function formatSlot(slot: string): string {
  return formatSlotForDisplay(slot);
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
  // Whether this address was reused from a previously OTP-verified customer
  // record ("saved") or freshly entered + just-OTP-verified in this session
  // ("new"). Drives which gate the payment page enforces server-side.
  source: "saved" | "new";
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
