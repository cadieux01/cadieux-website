// Shared constants + lightweight types for the new admin pages
// (src/app/admin/orders, customers, subscriptions, overview).
//
// Intentionally tiny — the goal is to keep the new admin surface
// internally consistent without forcing a refactor of the existing
// 2227-line src/app/admin/page.tsx.

// localStorage flag indicating the operator has a valid admin_session
// cookie. We can't read the HttpOnly cookie from JS, so we mirror its
// expiry here purely as UX (skip the password gate UI for 24h). The
// server-side cookie is the real credential.
import type { NutrientValue } from "@/lib/nutrition";

export const ADMIN_SESSION_KEY = "cadieux_admin_auth";

export const ORDER_STATUSES = [
  "placed",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "delivered",
  "cancelled",
  // pickup-only stages (see PICKUP_STAGES in lib/order-stages)
  "ready_for_pickup",
  "picked_up",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const SUBSCRIPTION_STATUSES = [
  // `pending_confirmation` is the state a subscription is born in (see
  // subscription-checkout.ts). Listing it first so the drawer's status
  // Select shows the real current state instead of a blank option, and
  // so the operator can move it to `active` from there too.
  "pending_confirmation",
  "active",
  "paused",
  "completed",
  "cancelled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

// `pending_payment` exists at the DB level for the mobile flow but the
// existing PATCH validator on /api/admin/orders/[id] only accepts the
// five above. We surface it as a filter chip on /admin/orders, but
// row-actions only show the transitions /api/admin/orders/[id] will
// actually accept.
export const ORDER_FILTER_VALUES = [
  "all",
  "pending_payment",
  "placed",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "delivered",
  "cancelled",
  // pickup-only stages surfaced as filter chips
  "ready_for_pickup",
  "picked_up",
  // Computed filter (NOT a stored orders.status value). Matches rows where
  // computeOrderState(o) === 'expired'. See src/lib/order-state.ts and the
  // client-side filter in src/app/admin/orders/page.tsx. Admin PATCH does
  // NOT accept 'expired' — it's derived on read, never written.
  "expired",
] as const;
export type OrderFilterValue = (typeof ORDER_FILTER_VALUES)[number];

export type AdminCustomerSummary = {
  id: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  /** Only projected by the single-order GET (/api/admin/orders/[id]);
   *  the list route omits it, so treat absent as unknown, not empty. */
  email?: string | null;
};

export type AdminOrderItemSnapshot = {
  slug?: string | null;
  product_id?: string | null;
  name: string;
  quantity?: number | null;
  qty?: number | null;
  unit_price_inr?: number | null;
  price_inr?: number | null;
  line_total_inr?: number | null;
  line_total?: number | null;
};

export type AdminOrderRow = {
  id: string;
  /** Human-facing order number ('OLF7', 'CDX-00006', …) assigned by the
   *  DB trigger public.tg_orders_assign_number. Nullable for legacy rows
   *  created before the trigger existed. Render via formatOrderNumber(). */
  order_number?: string | null;
  /** Customer-facing reference ('CX-7K4M2P'), assigned by the same
   *  trigger but drawn at random — it encodes no order volume. Admin
   *  shows it ALONGSIDE order_number so a customer who reads out their
   *  reference can be matched to the OLF number on the bag. */
  public_ref?: string | null;
  customer_id: string | null;
  total_amount: number | null;
  delivery_fee?: number | null;
  status: string | null;
  payment_method?: string | null;
  payment_status?: string | null;
  delivery_address: string | null;
  delivery_date: string | null;
  delivery_slot: string | null;
  items: AdminOrderItemSnapshot[] | null;
  created_at: string;
  /** GPS coords captured at checkout. Present on website orders after the
   *  share-location feature shipped (commit a79fde5) and on app orders
   *  once the new build is live. Null for everything before. */
  latitude?: number | null;
  longitude?: number | null;
  /** Road distance used to price the delivery fee. Single-order GET only. */
  distance_km?: number | null;
  /** 'delivery' | 'pickup'. Legacy rows may be null → treat as delivery. */
  fulfillment_type?: string | null;
  pickup_location_id?: string | null;
  pickup_ready_at?: string | null;
  picked_up_at?: string | null;
  pickup_location?: {
    id: string;
    name: string;
    area?: string | null;
    address?: string | null;
  } | null;
  /** Payment, refund and lifecycle-timestamp columns. Projected by the
   *  single-order GET only (/api/admin/orders/[id]) — the list route
   *  leaves them undefined to keep its payload small. */
  razorpay_order_id?: string | null;
  razorpay_payment_id?: string | null;
  paid_at?: string | null;
  status_updated_at?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  refund_status?: string | null;
  refund_id?: string | null;
  refunded_at?: string | null;
  /** Server-computed lifecycle state (mirror of the WhatsApp bot's
   *  classifyOrder). See src/lib/order-state.ts. Attached by
   *  /api/admin/orders. 'expired' = unpaid pending/placed > 7 days. */
  computed_state?: "delivered" | "cancelled" | "active" | "pending" | "expired";
  /** Preorder-mode stamp. True = order accepted during global preorder
   *  window; delivery_date may be null until admin schedules it. */
  is_preorder?: boolean | null;
  /** Timestamp when admin first set delivery_date on a preorder row. */
  scheduled_delivery_date_at?: string | null;
  customers?: AdminCustomerSummary | null;
};

export type AdminProductRow = {
  id: string;
  slug: string;
  name: string;
  price_inr: number;
  subscription_per_loaf_inr: number | null;
  // V10: per-product subscription discount %. The sub price is DERIVED
  // from price_inr × (1 − pct/100) via lib/subscription-pricing.ts.
  subscription_discount_pct: number;
  weight: string | null;
  description: string | null;
  tagline: string | null;
  highlights: string[];
  image_url: string | null;
  gallery_urls: string[];
  is_active: boolean;
  in_stock: boolean;
  is_archived: boolean;
  archived_at: string | null;
  sort_order: number;
  updated_at: string | null;
  is_subscription_plan: boolean;
  subscription_title: string | null;
  subscription_blurb: string | null;
  // Regulatory label fields (free-form). Rendered on PDP beneath the
  // description as separate sections; empty/null values are hidden.
  ingredients: string | null;
  allergens: string | null;
  // Per-slice nutrition JSONB. Open-ended shape — canonical keys are in
  // CANONICAL_NUTRIENT_KEYS, but custom keys are allowed. Empty object ===
  // null (no section rendered). A value is a number, or a lower-bound
  // string ("<0.04") for a "less than" lab result — see lib/nutrition.
  nutrition_per_slice: Record<string, NutrientValue> | null;
  slices_per_loaf: number | null;
};

export type AdminProductChangeRow = {
  id: string;
  changed_at: string;
  product_id: string;
  product_slug: string;
  field_changed: string;
  old_value: unknown;
  new_value: unknown;
  changed_by: string | null;
  context: string | null;
};

export type AdminSubscriptionRow = {
  id: string;
  customer_id: string;
  product_slug: string;
  product_name: string;
  quantity_per_delivery: number;
  frequency: string;
  total_weeks: number;
  total_amount: number;
  payment_status: string;
  status: string;
  created_at: string;
  // Plan timing fields are surfaced by the subscription drawer; the
  // server returns them via SELECT *, but they may be null/absent on
  // legacy rows.
  day_of_week?: string | null;
  time_slot?: string | null;
  delivery_address?: {
    name?: string | null;
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    pincode?: string | null;
    phone?: string | null;
  } | null;
  customer?: AdminCustomerSummary | null;
  // Server-computed using MAX(subscription_deliveries.delivery_date)
  // with a fallback to created_at + total_weeks * 7d. Matches the
  // derivation in src/app/api/cron/subscription-reminders/route.ts.
  derived_end_date?: string | null;
  remaining_deliveries?: number;
  // Total subscription_deliveries rows for this sub (any status). Feeds
  // the plan sentence's "N deliveries total" clause. Only present on the
  // ?enrich=1 list payload and the detail GET.
  total_deliveries?: number;
  // Coordinates matched from public.addresses by customer_id (see
  // subscription-coordinates.ts). Only set when a saved address has
  // finite, non-zero lat/lng; otherwise absent → Maps uses address text.
  latitude?: number | null;
  longitude?: number | null;

  // Columns only the detail page renders. Both subscription routes
  // select *, so these arrive on list rows too — they stay optional
  // because legacy rows leave several of them null.
  //
  // `days` + `slots_by_day` are what the customer actually picked: a
  // plan can run on several days a week, each with its own slot.
  // `day_of_week` / `time_slot` carry only the FIRST of those, so a
  // multi-day plan is not fully described without this pair.
  days?: string[] | null;
  slots_by_day?: Record<string, string> | null;
  slot_mode?: string | null;
  slot?: string | null;
  /** Per-loaf price captured at signup. */
  bread_price?: number | null;
  payment_method?: string | null;
  start_date?: string | null;
  is_preorder?: boolean | null;
  updated_at?: string | null;
  // Flat address snapshot written by the original wizard, kept
  // alongside the newer `delivery_address` jsonb.
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_address?: string | null;
  customer_city?: string | null;
  customer_pincode?: string | null;
};

export const DELIVERY_STATUS_OPTIONS = [
  "pending_confirmation",
  "confirmed",
  "out_for_delivery",
  "delivered",
  "cancelled",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUS_OPTIONS)[number];

export const DELIVERY_STATUS_LABELS: Record<string, string> = {
  pending_confirmation: "Pending",
  confirmed: "Confirmed",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

// ---------------------------------------------------------------------------
// Status-group sort ranks (display only — nothing is written back).
//
// Admin lists sort by urgency group first, newest-first within each group, so
// finished work stops pushing live work down the page. The group order is
// deliberately NOT the lifecycle order: `out_for_delivery` outranks
// `preparing` because a loaf already on a bike is the thing most likely to go
// wrong in the next hour.
//
//   1  pending          — nobody has touched it yet
//   2  in transit       — ready_for_pickup / out_for_delivery
//   3  preparing
//   4  confirmed
//   4.5 UNMAPPED        — see ORDER_RANK_FALLBACK below
//   5  finished         — delivered / picked_up
//   6  expired          — computed, not stored
//   7  cancelled
// ---------------------------------------------------------------------------

/** Rank for a status that is not in the map below.
 *
 *  Deliberately mid-table rather than last: orders.status has NO check
 *  constraint at the DB level (verified — the only status-ish constraint on
 *  the table is orders_refund_status_check), so an unrecognised value is
 *  reachable. Sinking it to the bottom would hide it beneath dozens of
 *  delivered orders; this puts it in the live-work region where it gets
 *  noticed. */
export const ORDER_RANK_FALLBACK = 4.5;

const ORDER_STATUS_RANK: Record<string, number> = {
  pending: 1,
  placed: 1,
  // Mobile-flow only, zero rows in prod. Un-actioned, and "pending" is what
  // an operator scans for.
  pending_payment: 1,
  ready_for_pickup: 2,
  out_for_delivery: 2,
  // Pre-migration alias of out_for_delivery (see lib/order-stages toStage).
  dispatched: 2,
  preparing: 3,
  confirmed: 4,
  delivered: 5,
  // Terminal-success twin of `delivered`. Pickup and delivery run as parallel
  // lanes: ready_for_pickup sits with out_for_delivery at 2 because a handover
  // still has to happen; picked_up sits with delivered at 5 because it did.
  picked_up: 5,
  cancelled: 7,
};

/** Sort rank for an order row. Lower sorts higher.
 *
 *  `expired` (rank 6) is COMPUTED, never stored — those rows carry
 *  status='pending' in the database and would otherwise land at rank 1, at the
 *  very top of the queue. Checked first for that reason. Reads the
 *  server-attached computed_state so this agrees with the expired filter chip
 *  and the row badge, which both do the same. */
export function orderStatusRank(order: {
  status?: string | null;
  computed_state?: string | null;
}): number {
  if (order.computed_state === "expired") return 6;
  const s = (order.status ?? "").toLowerCase();
  return ORDER_STATUS_RANK[s] ?? ORDER_RANK_FALLBACK;
}

const SUBSCRIPTION_STATUS_RANK: Record<string, number> = {
  pending_confirmation: 1,
  // An active subscription is live work, so it takes the same rank as an
  // order in transit.
  active: 2,
  // Dormant but not finished — sits with confirmed, above anything terminal.
  paused: 4,
  completed: 5,
  cancelled: 7,
};

/** Sort rank for a subscription row. Lower sorts higher. Same scale as
 *  orderStatusRank so the two admin lists read the same way; there is no
 *  computed expiry for subscriptions. */
export function subscriptionStatusRank(sub: {
  status?: string | null;
}): number {
  const s = (sub.status ?? "").toLowerCase();
  return SUBSCRIPTION_STATUS_RANK[s] ?? ORDER_RANK_FALLBACK;
}

export const SUBSCRIPTION_PAYMENT_STATUSES = [
  "pending",
  "paid",
  "failed",
  "refunded",
] as const;

export type AdminDeliveryRow = {
  id: string;
  subscription_id: string;
  week_number: number;
  scheduled_date: string;
  scheduled_time_slot: string;
  status: string;
  status_updated_at: string | null;
  admin_notes: string | null;

  // Generated schedule columns. `delivery_date` is the NOT NULL one the
  // reminder cron and end-date derivation read; `scheduled_date` is the
  // admin-editable copy the drawer edits. They match unless an admin has
  // moved a delivery.
  sequence?: number | null;
  day_key?: string | null;
  slot?: string | null;
  delivery_date?: string | null;
  /** Per-delivery item swap, when an admin has changed one week's order. */
  items_override?: unknown;
  created_at?: string | null;
};
