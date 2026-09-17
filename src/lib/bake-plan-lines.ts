// The two queries that answer "what is being baked for date D".
//
// ONE MODULE, TWO READERS:
//   • the 18:00 cron that emails the bake plan  (api/cron/delivery-bake-plan)
//   • the production strip above /admin/orders  (api/admin/bake-plan)
//
// They were about to become two — the strip summed `orders` client-side and
// knew nothing about `subscription_deliveries`, so the email that reached the
// baker's inbox at six and the strip he read at five in the morning were
// counting different loaves for the same day. A subscription stop is bread
// that has to come out of the same oven; leaving it out of the on-screen
// count is an UNDER-bake, which is the expensive direction.
//
// Both loaders live here rather than in either caller so that "what counts as
// due on day D" is decided exactly once. The status exclusion in particular
// —`NOT IN (delivered, cancelled)` — must be identical on both sides or the
// screen and the email disagree about a cancelled stop.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isPaidStatus } from "@/lib/payment-label";

/** One product line to bake. Structured, NOT the rendered "2 × Plain"
 *  string this used to be: the email built that string and then parsed it
 *  back with a regex to roll up totals, which meant a product name
 *  containing "×" silently split into a wrong quantity. Callers that want
 *  the string build it at render time. */
export interface BakeItem {
  name: string;
  qty: number;
}

/** One deliverable — same shape for orders and subscription deliveries. */
export interface BakePlanLine {
  /** "OLF56" for an order, "SUB OLS12" for a subscription delivery. */
  ref: string;
  /** Used for the section label and for the orders/subscriptions split. */
  kind: "order" | "subscription";
  /** Delivery slot as stored ("morning", "afternoon", null, …). */
  slot: string | null;
  customerName: string;
  /** As stored (10-digit or +91 form; not normalised). */
  customerPhone: string;
  /** Flattened address for the driver — line1 / city / pincode. */
  address: string;
  /** Explicit pincode where one is stored separately from the address
   *  text. Carried so a reader can resolve a delivery zone without
   *  re-parsing the flattened string. */
  pincode: string | null;
  items: BakeItem[];
  /** Rupees, integer. Running total only, never per-line display. */
  amountInr: number;
  /**
   * Has the money reached us?
   *
   * STATUS ONLY, never method — `isPaidStatus` is the same predicate the
   * rider's share message uses, so a `cod` + `paid` row (Pay Now leaves
   * the method alone) reads as paid here too. For a subscription delivery
   * this is the PARENT plan's payment state: a delivery row carries no
   * payment of its own.
   */
  paid: boolean;
}

// ── Row types ────────────────────────────────────────────────────────────

interface OrderRow {
  id: string;
  order_number: string | null;
  delivery_slot: string | null;
  delivery_address: string | null;
  total_amount: number | null;
  fulfillment_type: string | null;
  payment_status: string | null;
  items: unknown;
  customers: { full_name: string | null; phone: string | null } | null;
}

interface SubDeliveryRow {
  id: string;
  subscription_id: string;
  slot: string | null;
  scheduled_time_slot: string | null;
  items_override: unknown;
  subscriptions: {
    id: string;
    subscription_number: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    customer_pincode: string | null;
    payment_status: string | null;
    delivery_address: unknown;
  } | null;
}

interface SubItemRow {
  subscription_id: string;
  product_name: string | null;
  quantity_per_delivery: number | null;
}

interface RawItem {
  name?: unknown;
  product_name?: unknown;
  qty?: unknown;
  quantity?: unknown;
  quantity_per_delivery?: unknown;
}

interface SubAddress {
  name?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  pincode?: string | null;
  phone?: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Read one item line from whatever shape it is stored in. Orders use
 *  `{name, qty}`; a subscription's per-delivery override has been written
 *  with `product_name`/`quantity` and `quantity_per_delivery` too. Anything
 *  that is not a positive finite quantity yields null — a 0-loaf line is
 *  not baked and a NaN must never poison a sum. */
function readItem(raw: RawItem): BakeItem | null {
  const name = String(raw?.name ?? raw?.product_name ?? "").trim();
  if (!name) return null;
  const q = Number(raw?.qty ?? raw?.quantity ?? raw?.quantity_per_delivery ?? 0);
  if (!Number.isFinite(q) || q <= 0) return null;
  return { name, qty: Math.floor(q) };
}

function readItems(items: unknown): BakeItem[] {
  if (!Array.isArray(items)) return [];
  const out: BakeItem[] = [];
  for (const raw of items as RawItem[]) {
    const it = readItem(raw);
    if (it) out.push(it);
  }
  return out;
}

function flattenSubAddress(addr: unknown): string {
  if (!addr || typeof addr !== "object") return "";
  const a = addr as SubAddress;
  return [a.line1, a.line2, a.city, a.pincode]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean)
    .join(", ");
}

// ── Data legs ────────────────────────────────────────────────────────────

/** One-time orders due on `dateIso`, excluding delivered and cancelled. */
export async function loadOrderLines(
  supabase: SupabaseClient,
  dateIso: string,
): Promise<BakePlanLine[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, order_number, delivery_slot, delivery_address, total_amount, fulfillment_type, payment_status, items, customers(full_name, phone)",
    )
    .eq("delivery_date", dateIso)
    .not("status", "in", "(delivered,cancelled)");

  if (error) throw new Error(`orders leg: ${error.message}`);

  const rows = (data || []) as unknown as OrderRow[];
  return rows.map((o) => ({
    ref: o.order_number || `#${o.id.slice(0, 8).toUpperCase()}`,
    kind: "order" as const,
    slot: o.delivery_slot,
    customerName: (o.customers?.full_name || "Unknown").trim(),
    customerPhone: o.customers?.phone || "no phone",
    address:
      (o.delivery_address || "").trim() ||
      (o.fulfillment_type === "pickup" ? "PICKUP" : ""),
    pincode: null,
    items: readItems(o.items),
    amountInr:
      typeof o.total_amount === "number" ? Math.round(o.total_amount) : 0,
    paid: isPaidStatus(o.payment_status),
  }));
}

/** Subscription stops due on `dateIso`, excluding delivered and cancelled.
 *
 *  Deliberately does NOT filter on the parent plan's payment_status. An
 *  unpaid plan's deliveries are already written at checkout and the bread
 *  still has to be decided about; they are counted and flagged `paid:false`
 *  so a reader can put them on their own line rather than silently
 *  including or excluding them. */
export async function loadSubscriptionLines(
  supabase: SupabaseClient,
  dateIso: string,
): Promise<BakePlanLine[]> {
  const { data: dels, error } = await supabase
    .from("subscription_deliveries")
    .select(
      "id, subscription_id, slot, scheduled_time_slot, items_override, subscriptions(id, subscription_number, customer_name, customer_phone, customer_pincode, payment_status, delivery_address)",
    )
    .eq("delivery_date", dateIso)
    .not("status", "in", "(delivered,cancelled)");

  if (error) throw new Error(`subscription_deliveries leg: ${error.message}`);

  const deliveries = (dels || []) as unknown as SubDeliveryRow[];
  if (deliveries.length === 0) return [];

  // Bulk-fetch item defaults for every subscription in one query so we
  // don't fan out one lookup per delivery.
  const subIds = Array.from(
    new Set(deliveries.map((d) => d.subscription_id).filter(Boolean)),
  );
  const itemsBySub = new Map<string, BakeItem[]>();
  if (subIds.length > 0) {
    const { data: items, error: iErr } = await supabase
      .from("subscription_items")
      .select("subscription_id, product_name, quantity_per_delivery")
      .in("subscription_id", subIds);
    if (iErr) throw new Error(`subscription_items lookup: ${iErr.message}`);
    for (const row of (items || []) as SubItemRow[]) {
      const it = readItem(row);
      if (!it) continue;
      const list = itemsBySub.get(row.subscription_id) || [];
      list.push(it);
      itemsBySub.set(row.subscription_id, list);
    }
  }

  return deliveries.map((d) => {
    // Per-delivery override wins if present, else the plan's default items.
    const override = readItems(d.items_override);
    const items =
      override.length > 0 ? override : itemsBySub.get(d.subscription_id) || [];

    const sub = d.subscriptions;
    const parsedAddr =
      sub?.delivery_address && typeof sub.delivery_address === "object"
        ? (sub.delivery_address as SubAddress)
        : {};

    const ref = !sub
      ? "SUB —"
      : sub.subscription_number
        ? `SUB ${sub.subscription_number}`
        : `SUB #${sub.id.slice(0, 8).toUpperCase()}`;

    return {
      ref,
      kind: "subscription" as const,
      slot: d.slot || d.scheduled_time_slot,
      // Prefer the address's name/phone (edited per delivery) over the
      // subscription-level denormalised copy.
      customerName: (
        parsedAddr.name ||
        sub?.customer_name ||
        "Unknown"
      ).trim(),
      customerPhone: parsedAddr.phone || sub?.customer_phone || "no phone",
      address: flattenSubAddress(sub?.delivery_address),
      pincode: parsedAddr.pincode || sub?.customer_pincode || null,
      items,
      amountInr: 0,
      paid: isPaidStatus(sub?.payment_status),
    };
  });
}
