// Shared aggregator for the customer-facing "Your Requests" view.
//
// Both the web (cookie-auth) and mobile (bearer+X-App-Key) endpoints call
// `loadMyRequests(customerId)` to assemble the same shape:
//   - order change requests (delivery + items) for this customer's orders
//   - subscription change requests for this customer's subscriptions
//   - payment history rows derived from this customer's orders
//
// Read-only. The mutating endpoints (place a change request, cancel one,
// approve as admin, etc.) live on the order/subscription detail flows.
// We never trust client input here — owner scoping is by customer_id only.

import type { SupabaseClient } from "@supabase/supabase-js";

export type OrderChangeRequestRow = {
  id: string;
  order_id: string;
  type: string;
  status: string;
  requested_delivery_date: string | null;
  requested_delivery_slot: string | null;
  requested_delivery_address: string | null;
  requested_items: unknown | null;
  requested_total_amount: number | null;
  reason: string | null;
  admin_response: string | null;
  created_at: string;
  resolved_at: string | null;
  order: {
    id: string;
    status: string;
    total_amount: number;
    delivery_date: string | null;
    delivery_slot: string | null;
    delivery_address: string | null;
  } | null;
};

export type SubscriptionChangeRequestRow = {
  id: string;
  subscription_id: string;
  delivery_id: string;
  requested_date: string | null;
  requested_time_slot: string | null;
  reason: string | null;
  status: string;
  admin_response: string | null;
  created_at: string;
  updated_at: string | null;
};

export type PaymentRow = {
  order_id: string;
  status: string;
  total_amount: number;
  payment_status: string | null;
  payment_method: string | null;
  paid_at: string | null;
  razorpay_payment_id: string | null;
  created_at: string;
};

// "Unserviceable pincode" requests filed by this customer from
// /api/delivery-requests. Customers can submit these from the checkout
// CTA before any customer record may exist, so we scope by phone — and
// by customer_id when present — to surface both pre- and post-account
// rows.
export type DeliveryRequestRow = {
  id: string;
  pincode: string;
  area_name: string | null;
  address: string;
  status: string;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
};

export type MyRequestsPayload = {
  order_change_requests: OrderChangeRequestRow[];
  subscription_change_requests: SubscriptionChangeRequestRow[];
  payments: PaymentRow[];
  delivery_requests: DeliveryRequestRow[];
};

/**
 * Load the aggregated "Your Requests" payload for a single verified customer.
 *
 * Caller MUST already have authenticated the customer (cookie / bearer) and
 * resolved their customer_id. This function does not re-check auth — it just
 * scopes every query by customer_id.
 */
export async function loadMyRequests(
  supabase: SupabaseClient,
  customerId: string,
  phoneLocal10: string | null = null,
): Promise<MyRequestsPayload> {
  // 1) Pull the customer's orders (ids only for the change-request join,
  //    plus the columns we surface as "Payment history").
  const { data: orders, error: ordersErr } = await supabase
    .from("orders")
    .select(
      "id, status, total_amount, delivery_date, delivery_slot, delivery_address, payment_status, payment_method, paid_at, razorpay_payment_id, created_at",
    )
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (ordersErr) throw new Error(`orders: ${ordersErr.message}`);
  const orderRows = orders ?? [];
  const orderIds = orderRows.map((o) => o.id);
  const ordersById = new Map(orderRows.map((o) => [o.id, o]));

  // 2) Pull the customer's subscriptions (ids only).
  const { data: subs, error: subsErr } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("customer_id", customerId);
  if (subsErr) throw new Error(`subscriptions: ${subsErr.message}`);
  const subIds = (subs ?? []).map((s) => s.id);

  // 3) Order change requests, scoped via the customer's order ids.
  let orderCRs: OrderChangeRequestRow[] = [];
  if (orderIds.length > 0) {
    const { data, error } = await supabase
      .from("order_change_requests")
      .select(
        "id, order_id, type, status, requested_delivery_date, requested_delivery_slot, requested_delivery_address, requested_items, requested_total_amount, reason, admin_response, created_at, resolved_at",
      )
      .in("order_id", orderIds)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`order_change_requests: ${error.message}`);
    orderCRs = (data ?? []).map((r) => {
      const o = ordersById.get(r.order_id);
      return {
        ...(r as Omit<OrderChangeRequestRow, "order">),
        order: o
          ? {
              id: o.id,
              status: o.status,
              total_amount: Number(o.total_amount ?? 0),
              delivery_date: o.delivery_date ?? null,
              delivery_slot: o.delivery_slot ?? null,
              delivery_address: o.delivery_address ?? null,
            }
          : null,
      };
    });
  }

  // 4) Subscription change requests, scoped via the customer's subscription
  //    ids. Empty if the customer has no subscriptions.
  let subCRs: SubscriptionChangeRequestRow[] = [];
  if (subIds.length > 0) {
    const { data, error } = await supabase
      .from("subscription_change_requests")
      .select(
        "id, subscription_id, delivery_id, requested_date, requested_time_slot, reason, status, admin_response, created_at, updated_at",
      )
      .in("subscription_id", subIds)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`subscription_change_requests: ${error.message}`);
    subCRs = (data ?? []) as SubscriptionChangeRequestRow[];
  }

  // 5) Payment history is just a projection of orders, newest first, surfacing
  //    payment-relevant fields. No separate payments table exists.
  const payments: PaymentRow[] = orderRows.map((o) => ({
    order_id: o.id,
    status: o.status,
    total_amount: Number(o.total_amount ?? 0),
    payment_status: o.payment_status ?? null,
    payment_method: o.payment_method ?? null,
    paid_at: o.paid_at ?? null,
    razorpay_payment_id: o.razorpay_payment_id ?? null,
    created_at: o.created_at,
  }));

  // 6) Unserviceable-pincode requests. Scope by customer_id when known
  //    AND by phone when provided, so we still surface rows the customer
  //    filed before any customer record existed. Either column matching
  //    is fine — owner auth was already enforced upstream.
  let deliveryRequests: DeliveryRequestRow[] = [];
  const drFilters: string[] = [];
  if (customerId) drFilters.push(`customer_id.eq.${customerId}`);
  if (phoneLocal10 && /^\d{10}$/.test(phoneLocal10)) {
    drFilters.push(`phone.eq.${phoneLocal10}`);
  }
  if (drFilters.length > 0) {
    const { data, error } = await supabase
      .from("delivery_requests")
      .select(
        "id, pincode, area_name, address, status, resolved_at, resolution_note, created_at",
      )
      .or(drFilters.join(","))
      .order("created_at", { ascending: false });
    if (error) throw new Error(`delivery_requests: ${error.message}`);
    deliveryRequests = (data ?? []) as DeliveryRequestRow[];
  }

  return {
    order_change_requests: orderCRs,
    subscription_change_requests: subCRs,
    payments,
    delivery_requests: deliveryRequests,
  };
}
