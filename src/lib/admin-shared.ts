// Shared constants + lightweight types for the new admin pages
// (src/app/admin/orders, customers, subscriptions, overview).
//
// Intentionally tiny — the goal is to keep the new admin surface
// internally consistent without forcing a refactor of the existing
// 2227-line src/app/admin/page.tsx.

export const ADMIN_SESSION_KEY = "cadieux_admin_auth";
// Plaintext password gate matches the existing admin page. The real
// gate is the x-admin-token header sent on every API call — this
// sessionStorage flag is just UX so the operator doesn't have to
// retype the password every page-load.
export const ADMIN_PASSWORD = "cadieux2024";

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "dispatched",
  "delivered",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const SUBSCRIPTION_STATUSES = [
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
  "pending",
  "confirmed",
  "dispatched",
  "delivered",
  "cancelled",
] as const;
export type OrderFilterValue = (typeof ORDER_FILTER_VALUES)[number];

export type AdminCustomerSummary = {
  id: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
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
  customer_id: string | null;
  total_amount: number | null;
  delivery_fee?: number | null;
  status: string | null;
  delivery_address: string | null;
  delivery_date: string | null;
  delivery_slot: string | null;
  items: AdminOrderItemSnapshot[] | null;
  created_at: string;
  customers?: AdminCustomerSummary | null;
};

export type AdminProductRow = {
  id: string;
  slug: string;
  name: string;
  price_inr: number;
  subscription_per_loaf_inr: number | null;
  weight: string | null;
  description: string | null;
  tagline: string | null;
  highlights: string[];
  image_url: string | null;
  is_active: boolean;
  in_stock: boolean;
  is_archived: boolean;
  archived_at: string | null;
  sort_order: number;
  updated_at: string | null;
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
  customer?: AdminCustomerSummary | null;
  // Server-computed using MAX(subscription_deliveries.delivery_date)
  // with a fallback to created_at + total_weeks * 7d. Matches the
  // derivation in src/app/api/cron/subscription-reminders/route.ts.
  derived_end_date?: string | null;
  remaining_deliveries?: number;
};
