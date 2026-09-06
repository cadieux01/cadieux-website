// Display helpers for the admin Subscriptions surface (list + detail).
//
// Two jobs:
//   1. describeSubscriptionPlan — ONE line naming what is in the bag and
//      when it goes out: "Multigrain 1, Plain 1 — every week on Sunday".
//      The variants come from subscription_items, because the
//      subscriptions row sums them into a single product_name and a
//      quantity_per_delivery of 2 — which reads as two multigrain loaves
//      and is simply wrong for the very common 1 + 1 plan.
//   2. resolveSubscriptionAddress — the address is collected at signup
//      (delivery_address jsonb, or the flat customer_* snapshot on legacy
//      rows) but never shown. This normalises the two shapes into one and
//      flags the older rows that crammed everything into line1 with an
//      empty pincode as INCOMPLETE.
//
// Two colours / ≥14px / "—" for nulls are enforced at the call sites; this
// module is pure string logic.

import { DAY_LABEL } from "@/lib/subscription-ui";
import { variantLabel } from "@/lib/order-share-message";
import type {
  AdminSubscriptionItem,
  AdminSubscriptionRow,
} from "@/lib/admin-shared";

// ── Plan line ───────────────────────────────────────────────────────

/** Everything the plan line reads. Both the list row and the detail page
 *  pass a whole AdminSubscriptionRow; this keeps the dependency honest. */
type PlanShape = Pick<
  AdminSubscriptionRow,
  "product_name" | "quantity_per_delivery"
> & {
  items?: AdminSubscriptionItem[] | null;
  days?: string[] | null;
  day_of_week?: string | null;
  slots_by_day?: Record<string, string> | null;
  slot?: string | null;
  time_slot?: string | null;
};

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * The variants in one delivery. Rows written before subscription_items
 * existed fall back to the summed product_name × quantity pair on the
 * subscription itself, which is all they have.
 */
export function subscriptionItems(sub: PlanShape): AdminSubscriptionItem[] {
  const rows = (sub.items ?? []).filter(
    (i) => Number(i.quantity_per_delivery) > 0,
  );
  if (rows.length > 0) return rows;
  const qty = Number(sub.quantity_per_delivery ?? 0);
  if (!Number.isFinite(qty) || qty <= 0) return [];
  return [
    {
      product_slug: "",
      product_name: sub.product_name,
      quantity_per_delivery: qty,
    },
  ];
}

/** "Multigrain 1, Plain 1" — names the variants, never a bare total. */
export function formatSubscriptionItems(sub: PlanShape): string {
  const parts = subscriptionItems(sub).map(
    (i) => `${variantLabel(i.product_name)} ${i.quantity_per_delivery}`,
  );
  return parts.length > 0 ? parts.join(", ") : "—";
}

/** The days a plan runs, deduped and in week order — the stored array is
 *  in pick order, so a Thursday+Friday plan arrives as ["fri","thu"]. */
export function subscriptionDays(sub: PlanShape): string[] {
  const raw =
    sub.days && sub.days.length > 0
      ? sub.days
      : sub.day_of_week
        ? [sub.day_of_week]
        : [];
  const keys = Array.from(
    new Set(raw.map((d) => String(d).toLowerCase()).filter(Boolean)),
  );
  return keys.sort((a, b) => {
    const ia = DAY_ORDER.indexOf(a);
    const ib = DAY_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

function joinHuman(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "every week on Sunday" / "every week on Thursday and Friday". */
export function describeSubscriptionCadence(sub: PlanShape): string | null {
  const labels = subscriptionDays(sub).map((d) => DAY_LABEL[d] ?? d);
  return labels.length > 0 ? `every week on ${joinHuman(labels)}` : null;
}

/** The slot for one day, falling back to the plan-wide one. */
export function slotForDay(sub: PlanShape, day: string): string | null {
  return sub.slots_by_day?.[day] ?? sub.slot ?? sub.time_slot ?? null;
}

/**
 * ONE line for the plan: what is in the bag, and when it goes out.
 *
 *   "Multigrain 1, Plain 1 — every week on Sunday"
 *   "Plain 5 — every week on Thursday and Friday"
 */
export function describeSubscriptionPlan(sub: PlanShape): string {
  const items = formatSubscriptionItems(sub);
  const cadence = describeSubscriptionCadence(sub);
  if (items === "—") return cadence ?? "—";
  return cadence ? `${items} — ${cadence}` : items;
}

/** Days and times only, on ONE line: "Sunday · 07:30", or
 *  "Thursday · 20:00 · Friday · 16:30". A day with no slot shows alone. */
export function describeDeliveryDays(sub: PlanShape): string {
  const parts = subscriptionDays(sub).map((d) => {
    const label = DAY_LABEL[d] ?? d;
    const slot = slotForDay(sub, d);
    return slot ? `${label} · ${slot}` : label;
  });
  return parts.length > 0 ? parts.join(" · ") : "—";
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
