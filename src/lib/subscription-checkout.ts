// Shared subscription-write helpers.
//
// Extracted from the "place_subscription" (multi-variant) branch of
// POST /api/checkout so that both the public checkout flow AND the
// admin manual-entry endpoint (POST /api/admin/subscriptions) go through
// the SAME DB writes — no drift possible between the two.
//
// This file intentionally covers only the multi-variant path (V10 wizard
// / admin form). The legacy single-variant path in /api/checkout is left
// inline and untouched; it's only used by the old /subscription wizard.
//
// The helpers below are a PURE code-move of the three inserts in the
// multi-variant branch:
//   1. INSERT into `subscriptions` (parent row)
//   2. INSERT into `subscription_items` (per-variant price snapshot)
//   3. INSERT into `subscription_deliveries` (per-delivery schedule)
//
// Column shapes, insert order, error-handling responses, and console
// error strings match the pre-extraction checkout code byte-for-byte,
// so the public flow behaves identically after the refactor.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DayKey } from "@/lib/subscription-dates";

// ── Types ───────────────────────────────────────────────────────────

/** One priced variant on the subscription. Column names match the
 *  subscription_items table exactly. */
export type SubscriptionSnapItem = {
  product_slug: string;
  product_name: string;
  quantity_per_delivery: number;
  price_snapshot_inr: number;
};

/** One row in the per-delivery schedule. Column names match the
 *  subscription_deliveries table exactly. */
export type SubscriptionDeliveryRow = {
  sequence: number;
  week_number: number;
  day_key: string;
  slot: string | null;
  delivery_date: string; // YYYY-MM-DD
  status: string; // "pending_confirmation"
  scheduled_date: string; // mirrors delivery_date
  scheduled_time_slot: string | null;
};

/** Structured error shape mirroring the NextResponse payloads the
 *  checkout route used to return inline. Callers translate `status` +
 *  `body` into their own response object (NextResponse.json / etc.). */
export type SubscriptionWriteError = {
  status: number;
  body: { error: string; details?: string };
};

/** Full context needed to compose the multi-variant `subscriptions`
 *  insert row. Field names mirror what the checkout branch destructures
 *  from the request body so the two callers pass in the same values. */
export type MultiVariantSubscriptionInsertCtx = {
  /** Primary variant used for the legacy mirror columns
   *  (bread_slug / bread_name / bread_price / product_slug / product_name).
   *  Callers pass snapItems[0] here — identical to the checkout branch. */
  primary: SubscriptionSnapItem;
  /** Sum of quantity_per_delivery across all snapItems. */
  totalUnits: number;
  weeks: number;
  dayKeys: DayKey[];
  slot_mode: string | null;
  slot: string | null;
  slots_by_day: Record<string, string> | null;
  /** Server-derived amount (pricePerLoaf × qty × deliveryCount). */
  serverAmount: number;
  frequency: "weekly" | "bi-weekly";
  customer_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  customer_city: string | null;
  customer_pincode: string | null;
  /** JSONB address blob written to subscriptions.delivery_address. */
  deliveryAddressJson: {
    name: string | null;
    phone: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    pincode: string | null;
  };
  subStatus: "active" | "pending_confirmation";
  paymentMethod: "cod" | null;
};

// ── Insert-row builder ──────────────────────────────────────────────

/**
 * Compose the `subscriptions` insert row for the multi-variant path.
 *
 * Field order / naming matches the checkout branch exactly (see the
 * pre-extraction block that started at `.from("subscriptions").insert({...})`
 * in POST /api/checkout, multi-variant branch). Any change here MUST
 * preserve byte-identical writes for the public checkout flow.
 */
export function buildMultiVariantSubscriptionInsert(
  ctx: MultiVariantSubscriptionInsertCtx,
): Record<string, unknown> {
  const {
    primary,
    totalUnits,
    weeks,
    dayKeys,
    slot_mode,
    slot,
    slots_by_day,
    serverAmount,
    frequency,
    customer_id,
    customer_name,
    customer_phone,
    customer_address,
    customer_city,
    customer_pincode,
    deliveryAddressJson,
    subStatus,
    paymentMethod,
  } = ctx;

  return {
    // Legacy mirror columns — primary variant + blended totals so old
    // admin views still render. Per-variant truth lives in subscription_items.
    bread_slug: primary.product_slug,
    bread_name: primary.product_name,
    bread_price: primary.price_snapshot_inr,
    weeks,
    days: dayKeys,
    slot_mode,
    slot: slot_mode === "same" ? slot : null,
    slots_by_day: slot_mode === "custom" ? slots_by_day : null,
    total: serverAmount,
    customer_name,
    customer_phone,
    customer_address,
    customer_city,
    customer_pincode,
    status: subStatus,
    customer_id,
    product_slug: primary.product_slug,
    product_name: primary.product_name,
    quantity_per_delivery: totalUnits,
    frequency,
    day_of_week: dayKeys[0] ?? null,
    time_slot:
      slot_mode === "same" ? slot : (slots_by_day?.[dayKeys[0]] ?? null),
    total_weeks: weeks,
    delivery_address: deliveryAddressJson,
    total_amount: serverAmount,
    payment_status: "pending",
    payment_method: paymentMethod,
  };
}

// ── Three-step writer ───────────────────────────────────────────────

export type MultiVariantWriteResult =
  | {
      ok: true;
      subscription_id: string;
      deliveries: number;
      items: number;
    }
  | { ok: false; error: SubscriptionWriteError };

/**
 * Run the three inserts (subscriptions → subscription_items →
 * subscription_deliveries) that persist a multi-variant subscription.
 *
 * Callers are responsible for having already:
 *   • verified the customer / OTP,
 *   • priced the plan server-side,
 *   • built the delivery template.
 *
 * On any DB error this returns a structured `SubscriptionWriteError` so
 * the calling route can translate it into its own response envelope
 * (NextResponse.json for the checkout / admin routes).
 *
 * The console.error strings and error `.details` payloads are preserved
 * exactly from the pre-extraction checkout code so log-based alerting /
 * dashboards keep matching.
 */
export async function insertMultiVariantSubscription(
  supabase: SupabaseClient,
  subInsertRow: Record<string, unknown>,
  snapItems: SubscriptionSnapItem[],
  deliveryTemplate: SubscriptionDeliveryRow[],
): Promise<MultiVariantWriteResult> {
  // 1. Parent row.
  const { data: sub, error: subErr } = await supabase
    .from("subscriptions")
    .insert(subInsertRow)
    .select("id")
    .single();

  if (subErr || !sub) {
    console.error("❌ Subscription insert failed:", subErr);
    return {
      ok: false,
      error: {
        status: 500,
        body: {
          error: "Failed to create subscription",
          details: subErr?.message,
        },
      },
    };
  }

  // 2. Per-variant price snapshots.
  const { error: itemsErr } = await supabase
    .from("subscription_items")
    .insert(snapItems.map((s) => ({ subscription_id: sub.id, ...s })));

  if (itemsErr) {
    console.error("❌ subscription_items insert failed:", itemsErr);
    return {
      ok: false,
      error: {
        status: 500,
        body: {
          error: "Failed to create subscription items",
          details: itemsErr.message,
        },
      },
    };
  }

  // 3. Concrete deliveries.
  const deliveryRows = deliveryTemplate.map((d) => ({
    subscription_id: sub.id,
    ...d,
  }));
  if (deliveryRows.length > 0) {
    const { error: delErr } = await supabase
      .from("subscription_deliveries")
      .insert(deliveryRows);
    if (delErr) {
      console.error("❌ Delivery insert failed:", delErr);
      return {
        ok: false,
        error: {
          status: 500,
          body: {
            error: "Failed to create deliveries",
            details: delErr.message,
          },
        },
      };
    }
  }

  return {
    ok: true,
    subscription_id: sub.id,
    deliveries: deliveryRows.length,
    items: snapItems.length,
  };
}
