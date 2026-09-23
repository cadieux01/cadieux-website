// Loaf counting for the admin Subscriptions surface.
//
// ONE SOURCE OF TRUTH: subscription_items. The subscriptions row also
// carries product_slug / product_name / quantity_per_delivery, and on a
// mixed plan those are actively misleading rather than merely incomplete.
// Measured on prod 2026-09-22: all nine multi-variant plans store
// product_name = "Protein Bread — Multigrain" — including OLS7, which is
// Plain 2 + Multigrain 2, and OLS11/14/29/32, where the Plain line was
// written FIRST. quantity_per_delivery holds the correct combined total.
//
// So counting off the legacy pair does not under-report the number of
// loaves; it books ALL of them to Multigrain and leaves Plain at zero.
// Across the nine that is 21 loaves-per-delivery attributed to Multigrain
// when the truth is Multigrain 11 / Plain 10. A total that is right for
// the wrong reason is the hardest kind of wrong to notice, which is why
// every counter here goes through subscriptionItems().
//
// `subscriptionItems()` (subscription-display.ts) already encodes the
// correct precedence — items when present, the legacy pair only for rows
// written before subscription_items existed — so this module builds on it
// rather than re-deriving it. There are no such rows on prod today (all 43
// subscriptions have at least one item row), but the fallback is the
// contract and removing it would silently zero any that appear.

import type { AdminSubscriptionItem } from "@/lib/admin-shared";
import { subscriptionItems } from "@/lib/subscription-display";
import { variantLabel } from "@/lib/order-share-message";
import { toIstDay } from "@/lib/day-filter";

/** The delivery fields counting needs. Deliberately narrower than
 *  AdminDeliveryRow so this stays a leaf as that row grows. */
export type CountableDelivery = {
  status?: string | null;
  /** The originally-booked date. NOT NULL in the schema. */
  delivery_date?: string | null;
  /** The admin-edited date, when a stop has been moved. Populated on ALL
   *  117 prod rows today, so it is the usual reader, not the exception. */
  scheduled_date?: string | null;
  week_number?: number | null;
  /** Per-delivery replacement for the plan's default items. */
  items_override?: unknown;
};

/** The plan fields counting needs — whatever subscriptionItems() reads. */
export type CountablePlan = {
  product_name?: string | null;
  quantity_per_delivery?: number | null;
  items?: AdminSubscriptionItem[] | null;
};

/** slug → loaves. Slug, not display name: two rows for the same product
 *  that spell the name differently must not become two buckets. */
export type LoafCounts = Map<string, number>;

/** Cancelled deliveries are excluded from every count on this surface.
 *  They will not be baked and nobody is owed them. */
export function isCancelledDelivery(d: CountableDelivery): boolean {
  return (d.status ?? "").toLowerCase() === "cancelled";
}

function qtyOf(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The items actually going out on ONE delivery: the per-delivery override
 * when it has content, otherwise the plan's default lines.
 *
 * Same precedence as the bake plan (lib/bake-plan-lines.ts) — the two must
 * never disagree about what a stop contains.
 *
 * NOTE: `items_override` is NULL on all 113 delivery rows in production
 * today, so this branch is unexercised by real data. It is implemented
 * because it is the contract, not because it was verified against prod.
 */
export function deliveryItems(
  d: CountableDelivery,
  planItems: AdminSubscriptionItem[],
): AdminSubscriptionItem[] {
  const raw = d.items_override;
  if (!Array.isArray(raw) || raw.length === 0) return planItems;
  const out: AdminSubscriptionItem[] = [];
  for (const it of raw as Record<string, unknown>[]) {
    if (!it || typeof it !== "object") continue;
    const slug = String(it.product_slug ?? it.slug ?? "").trim();
    const name = String(it.product_name ?? it.name ?? "").trim();
    if (!slug && !name) continue;
    // Overrides are written by the order editor, which uses `qty`; the
    // plan's own rows use `quantity_per_delivery`. Accept either.
    const qty = qtyOf(it.quantity_per_delivery ?? it.quantity ?? it.qty);
    if (qty === 0) continue;
    out.push({
      product_slug: slug,
      product_name: name || slug,
      quantity_per_delivery: qty,
    });
  }
  // An override that parsed to nothing usable is NOT "this stop is empty" —
  // it is a shape we do not understand, and silently dropping the stop
  // would under-bake. Fall back to the plan.
  return out.length > 0 ? out : planItems;
}

/** The plan's default lines, via the shared legacy-aware reader.
 *
 *  The two legacy columns are coerced because CountablePlan accepts a
 *  partial projection while the reader wants the full, non-null columns.
 *  Both coercions only reach the legacy branch, and there a blank name is
 *  dropped by sumItems() rather than counted under an empty bucket, and a
 *  zero quantity makes the reader return no lines at all. */
export function planItemsOf(plan: CountablePlan): AdminSubscriptionItem[] {
  return subscriptionItems({
    ...plan,
    product_name: plan.product_name ?? "",
    quantity_per_delivery: plan.quantity_per_delivery ?? 0,
  });
}

/**
 * Loaves in a set of item lines, by slug.
 *
 * Keyed on product_slug, falling back to product_name ONLY for the legacy
 * shape `subscriptionItems()` synthesises, which has no slug to offer.
 * Every counter on this surface goes through here so the bucket key is
 * decided in exactly one place.
 */
export function sumItems(items: AdminSubscriptionItem[]): LoafCounts {
  const out: LoafCounts = new Map();
  for (const it of items) {
    const key = it.product_slug || it.product_name || "";
    if (!key) continue;
    const q = qtyOf(it.quantity_per_delivery);
    if (q === 0) continue;
    out.set(key, (out.get(key) ?? 0) + q);
  }
  return out;
}

/** Loaves on ONE delivery, by slug. */
export function countDelivery(
  d: CountableDelivery,
  planItems: AdminSubscriptionItem[],
): LoafCounts {
  if (isCancelledDelivery(d)) return new Map();
  return sumItems(deliveryItems(d, planItems));
}

/** Loaves in ONE of a plan's deliveries — its per-delivery figure. */
export function countPlan(plan: CountablePlan): LoafCounts {
  return sumItems(planItemsOf(plan));
}

/** Add `src` into `dst` in place. */
export function addCounts(dst: LoafCounts, src: LoafCounts): LoafCounts {
  src.forEach((v, k) => dst.set(k, (dst.get(k) ?? 0) + v));
  return dst;
}

/** A plain `slug → loaves` object (as the list route ships) back into a
 *  Map, so it can go through the same helpers as a freshly-counted one. */
export function countsFromRecord(
  rec: Record<string, number> | null | undefined,
): LoafCounts {
  const out: LoafCounts = new Map();
  for (const k of Object.keys(rec ?? {})) {
    const q = qtyOf(rec?.[k]);
    if (q > 0) out.set(k, q);
  }
  return out;
}

/** Loaves across a set of deliveries for ONE plan, cancelled excluded. */
export function countDeliveries(
  deliveries: CountableDelivery[],
  plan: CountablePlan,
): LoafCounts {
  const planItems = planItemsOf(plan);
  const out: LoafCounts = new Map();
  for (const d of deliveries) addCounts(out, countDelivery(d, planItems));
  return out;
}

/**
 * The calendar day a delivery belongs to, for date-scoped counting.
 *
 * `scheduled_date ?? delivery_date` — DELIBERATELY the same precedence
 * buildDerivations uses to build `delivery_dates`, which is the set the
 * board's day filter matches ROWS against. These two must never diverge:
 * the summary counts what the table lists, so if one reads the raw booked
 * date and the other reads the moved date, a rescheduled stop is counted
 * on a day its row is not shown on, and the bar contradicts the rows
 * directly beneath it.
 *
 * That is not hypothetical. On prod 2026-09-23 exactly one row diverges —
 * booked for the 23rd, moved to the 21st, already delivered. Counting it
 * on the 23rd would tell the kitchen to bake a loaf for a stop that was
 * served two days earlier.
 *
 * Returns null when there is no usable date, so the caller can skip the
 * row rather than bucket it under an empty key.
 */
export function deliveryDayKey(d: CountableDelivery): string | null {
  return toIstDay(d.scheduled_date ?? d.delivery_date);
}

/**
 * Loaves for ONE plan, split by the day each delivery lands on.
 *
 * This is what lets the board answer "what do we bake on the 23rd" rather
 * than only "what does this plan come to over its life". items_override is
 * honoured per delivery via countDelivery, so a stop that was edited to a
 * different bread counts as the bread that is actually going out — the
 * whole-plan total already did this, and a date-scoped total that did not
 * would be a quieter version of the same bug.
 *
 * Cancelled rows are skipped BEFORE the bucket is created, so a date whose
 * only stop was cancelled is absent from the map rather than present with
 * zero. Absent and zero read the same in the UI but not in code: `.get()`
 * returning undefined is the honest answer to "is anything going out".
 */
export function countDeliveriesByDate(
  deliveries: CountableDelivery[],
  plan: CountablePlan,
): Map<string, LoafCounts> {
  const planItems = planItemsOf(plan);
  const out = new Map<string, LoafCounts>();
  for (const d of deliveries) {
    if (isCancelledDelivery(d)) continue;
    const key = deliveryDayKey(d);
    if (!key) continue;
    let bucket = out.get(key);
    if (!bucket) out.set(key, (bucket = new Map()));
    addCounts(bucket, countDelivery(d, planItems));
  }
  return out;
}

/** `date → slug → loaves`, the wire shape the list route ships. */
export function countsByDateToRecord(
  byDate: Map<string, LoafCounts>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  byDate.forEach((counts, date) => {
    out[date] = Object.fromEntries(counts);
  });
  return out;
}

/** The wire shape back into Maps, so it goes through the same helpers as a
 *  freshly-counted one. */
export function countsByDateFromRecord(
  rec: Record<string, Record<string, number>> | null | undefined,
): Map<string, LoafCounts> {
  const out = new Map<string, LoafCounts>();
  for (const date of Object.keys(rec ?? {})) {
    out.set(date, countsFromRecord(rec?.[date]));
  }
  return out;
}

/** Loaves across many plans — the counter bar's arithmetic. Each plan
 *  brings its own deliveries, so a plan with none contributes nothing
 *  rather than contributing its per-delivery figure once. */
export function countPlans<T extends CountablePlan>(
  plans: T[],
  deliveriesOf: (p: T) => CountableDelivery[],
): LoafCounts {
  const out: LoafCounts = new Map();
  for (const p of plans) addCounts(out, countDeliveries(deliveriesOf(p), p));
  return out;
}

// ── Presentation ────────────────────────────────────────────────────

/** Stable display order: Plain, then Multigrain, then anything else
 *  alphabetically. Fixed so the bar does not reshuffle between renders. */
const SLUG_ORDER = ["high-protein", "multigrain"];

export type CountLine = {
  slug: string;
  /** "Plain" / "Multigrain" — the short variant name. */
  label: string;
  loaves: number;
};

/** Display names for the two bread slugs. Falls back to variantLabel on
 *  the item's own product_name for anything unmapped, so a new product
 *  appears with a sensible name and no code change. */
const SLUG_LABEL: Record<string, string> = {
  "high-protein": "Plain",
  multigrain: "Multigrain",
};

export function labelForSlug(slug: string, fallbackName?: string | null): string {
  return SLUG_LABEL[slug] ?? variantLabel(fallbackName ?? slug);
}

/** Counts → ordered lines for rendering. Zero-loaf entries are dropped:
 *  a product nobody ordered is absence, not a zero worth a marker. */
export function countLines(
  counts: LoafCounts,
  nameHint?: Map<string, string>,
): CountLine[] {
  return Array.from(counts.entries())
    .filter(([, loaves]) => loaves > 0)
    .map(([slug, loaves]) => ({
      slug,
      label: labelForSlug(slug, nameHint?.get(slug)),
      loaves,
    }))
    .sort((a, b) => {
      const ia = SLUG_ORDER.indexOf(a.slug);
      const ib = SLUG_ORDER.indexOf(b.slug);
      if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.label.localeCompare(b.label);
    });
}

/** slug → the name last seen for it, so unmapped products can still be
 *  labelled from their stored name rather than their slug. */
export function nameHintFor(plans: CountablePlan[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of plans) {
    for (const it of planItemsOf(p)) {
      if (it.product_slug && it.product_name) m.set(it.product_slug, it.product_name);
    }
  }
  return m;
}

/** "P 2 · M 1" — the per-delivery chip. Empty string when nothing counts,
 *  so callers can render nothing rather than an empty chip. */
export function shortCountText(lines: CountLine[]): string {
  return lines.map((l) => `${l.label.charAt(0)} ${l.loaves}`).join(" · ");
}

/** "Plain 2, Multigrain 1" — the long form, for title attributes. */
export function longCountText(lines: CountLine[]): string {
  return lines.map((l) => `${l.label} ${l.loaves}`).join(", ");
}

/** Total loaves across all products. */
export function totalLoaves(counts: LoafCounts): number {
  let n = 0;
  counts.forEach((v) => {
    n += v;
  });
  return n;
}
