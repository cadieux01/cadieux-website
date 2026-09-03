// Display helpers for the admin Subscriptions surface (list + detail).
//
// Two jobs:
//   1. describeSubscriptionPlan — turn the cryptic column soup
//      (quantity_per_delivery / days / total_weeks / delivery count) into
//      ONE sentence where every number carries a unit, so "4" is never
//      shown bare. The delivery TOTAL always comes from the real
//      subscription_deliveries count the caller passes in — never
//      weeks × days, which lies on custom / partial plans.
//   2. resolveSubscriptionAddress — the address is collected at signup
//      (delivery_address jsonb, or the flat customer_* snapshot on legacy
//      rows) but never shown. This normalises the two shapes into one and
//      flags the older rows that crammed everything into line1 with an
//      empty pincode as INCOMPLETE.
//
// Two colours / ≥14px / "—" for nulls are enforced at the call sites; this
// module is pure string logic.

import { DAY_LABEL } from "@/lib/subscription-ui";
import type { AdminSubscriptionRow } from "@/lib/admin-shared";

// ── Plan sentence ───────────────────────────────────────────────────

function loafClause(qty: number | null | undefined): string | null {
  if (qty == null || !Number.isFinite(qty) || qty <= 0) return null;
  return `${qty} ${qty === 1 ? "loaf" : "loaves"} per delivery`;
}

/** Human day list. Single day → "every Thursday"; multiple → pluralised
 *  and joined ("Tuesdays and Wednesdays", "Mondays, Wednesdays and
 *  Fridays"). Unknown keys fall through as-is. */
function daysClause(days: string[] | null | undefined): string | null {
  if (!days || days.length === 0) return null;
  const labels = days
    .map((d) => DAY_LABEL[String(d).toLowerCase()] ?? String(d))
    .filter(Boolean);
  if (labels.length === 0) return null;
  if (labels.length === 1) return `every ${labels[0]}`;
  const plural = labels.map((l) => `${l}s`);
  const last = plural[plural.length - 1];
  const head = plural.slice(0, -1);
  return `${head.join(", ")} and ${last}`;
}

function weeksClause(weeks: number | null | undefined): string | null {
  // weeks = 0 exists on custom plans → omit the clause entirely.
  if (weeks == null || !Number.isFinite(weeks) || weeks <= 0) return null;
  return `${weeks} ${weeks === 1 ? "week" : "weeks"}`;
}

function deliveriesClause(count: number | null | undefined): string | null {
  if (count == null || !Number.isFinite(count) || count <= 0) return null;
  return `${count} ${count === 1 ? "delivery" : "deliveries"} total`;
}

/**
 * One-sentence plan summary. `deliveryCount` MUST be the real
 * subscription_deliveries row count (list: sub.total_deliveries; detail:
 * deliveries.length) — never weeks × days.
 *
 * Examples:
 *   "4 loaves per delivery · every Thursday · 1 week · 1 delivery total"
 *   "2 loaves per delivery · Tuesdays and Wednesdays · 2 deliveries total"
 */
export function describeSubscriptionPlan(
  sub: Pick<AdminSubscriptionRow, "quantity_per_delivery" | "total_weeks"> & {
    days?: string[] | null;
    day_of_week?: string | null;
  },
  deliveryCount: number | null | undefined,
): string {
  const days =
    sub.days && sub.days.length > 0
      ? sub.days
      : sub.day_of_week
        ? [sub.day_of_week]
        : null;

  const clauses = [
    loafClause(sub.quantity_per_delivery),
    daysClause(days),
    weeksClause(sub.total_weeks),
    deliveriesClause(deliveryCount),
  ].filter(Boolean) as string[];

  return clauses.length > 0 ? clauses.join(" · ") : "—";
}

// ── Address ─────────────────────────────────────────────────────────

export type ResolvedSubscriptionAddress = {
  name: string | null;
  /** The address's OWN phone (jsonb.phone, or the flat snapshot's phone).
   *  May differ from the customer record — callers show both if so. */
  phone: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  pincode: string | null;
  /** True when there's no pincode — the older rows crammed everything
   *  into line1 and left pincode "". Surface this visibly. */
  incomplete: boolean;
  /** False when we found nothing at all → render "—". */
  hasAny: boolean;
};

function clean(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Normalise the two stored address shapes into one:
 *   - delivery_address jsonb (newer rows), preferred when it carries any
 *     of line1 / city / pincode.
 *   - the flat customer_address / customer_city / customer_pincode
 *     snapshot (legacy rows).
 */
export function resolveSubscriptionAddress(
  sub: AdminSubscriptionRow,
): ResolvedSubscriptionAddress {
  const j = sub.delivery_address ?? null;
  const jHasAny =
    !!j && (!!clean(j.line1) || !!clean(j.city) || !!clean(j.pincode));

  const line1 = jHasAny ? clean(j?.line1) : clean(sub.customer_address);
  const line2 = jHasAny ? clean(j?.line2) : null;
  const city = jHasAny ? clean(j?.city) : clean(sub.customer_city);
  const pincode = jHasAny ? clean(j?.pincode) : clean(sub.customer_pincode);
  const name = jHasAny ? clean(j?.name) : clean(sub.customer_name);
  const phone = jHasAny ? clean(j?.phone) : clean(sub.customer_phone);

  const hasAny = !!(line1 || line2 || city || pincode);

  return {
    name,
    phone,
    line1,
    line2,
    city,
    pincode,
    incomplete: hasAny && !pincode,
    hasAny,
  };
}

/** Compact one-line form for the list row: line1 · city · pincode, with
 *  empty parts dropped so there's never a dangling separator. */
export function formatAddressShort(addr: ResolvedSubscriptionAddress): string {
  const parts = [addr.line1, addr.city, addr.pincode].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/** Full multi-line form for the detail page / maps query. */
export function formatAddressFull(addr: ResolvedSubscriptionAddress): string {
  const parts = [addr.line1, addr.line2, addr.city, addr.pincode].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(", ") : "—";
}

/** Last-10-digit compare, so "+91 98…" and "098…" count as the same. */
export function phonesDiffer(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const da = String(a ?? "").replace(/\D+/g, "").slice(-10);
  const db = String(b ?? "").replace(/\D+/g, "").slice(-10);
  if (!da || !db) return false; // can't compare → don't claim a difference
  return da !== db;
}
