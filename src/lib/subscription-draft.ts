// Client-side draft state for the subscription setup wizard.
// Stored in sessionStorage so it survives reloads but is scoped per tab.

import { PRODUCTS } from "@/lib/data";

export const SETUP_STEPS = [
  "product",
  "frequency",
  "day",
  "duration",
  "time-slot",
  "address",
  "review",
  "checkout",
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const FREQUENCIES = [
  { key: "weekly", label: "Weekly", helper: "Once a week" },
  { key: "bi-weekly", label: "Bi-weekly", helper: "Every two weeks" },
] as const;

export const DAY_OPTIONS = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
] as const;

export const DURATION_OPTIONS = [4, 8, 12, 24] as const; // weeks
export const QUANTITY_OPTIONS = [1, 2, 3, 4] as const;

export const TIME_SLOTS = [
  "7 – 9 am",
  "9 – 11 am",
  "12 – 2 pm",
  "5 – 7 pm",
  "7 – 9 pm",
] as const;

export type DraftAddress = {
  name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  pincode: string;
};

export type SubscriptionDraft = {
  product_slug: string | null;
  quantity_per_delivery: number;
  frequency: string | null; // "weekly" | "bi-weekly"
  day_of_week: string | null;
  total_weeks: number | null;
  time_slot: string | null;
  address: DraftAddress;
  payment_method: string;
};

const STORAGE_KEY = "cadieux_sub_draft_v2";

export function emptyDraft(): SubscriptionDraft {
  return {
    product_slug: null,
    quantity_per_delivery: 1,
    frequency: null,
    day_of_week: null,
    total_weeks: null,
    time_slot: null,
    address: { name: "", phone: "", line1: "", line2: "", city: "", pincode: "" },
    payment_method: "cod",
  };
}

export function loadDraft(): SubscriptionDraft {
  if (typeof window === "undefined") return emptyDraft();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDraft();
    return { ...emptyDraft(), ...JSON.parse(raw) };
  } catch {
    return emptyDraft();
  }
}

export function saveDraft(d: SubscriptionDraft): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch {
    /* ignore */
  }
}

export function clearDraft(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Cost = product unit price × qty per delivery × total_weeks. */
export function draftTotal(d: SubscriptionDraft): number {
  const p = PRODUCTS.find((x) => x.slug === d.product_slug);
  if (!p || !d.total_weeks) return 0;
  return p.price * d.quantity_per_delivery * d.total_weeks;
}

/** Returns the first step that's not satisfied, or null if all satisfied. */
export function firstIncompleteStep(d: SubscriptionDraft): SetupStep | null {
  if (!d.product_slug) return "product";
  if (!d.frequency) return "frequency";
  if (!d.day_of_week) return "day";
  if (!d.total_weeks) return "duration";
  if (!d.time_slot) return "time-slot";
  const a = d.address;
  if (!a.name || !a.phone || !a.line1 || !a.city || !a.pincode) return "address";
  return null;
}

export function stepIndex(s: SetupStep): number {
  return SETUP_STEPS.indexOf(s);
}
