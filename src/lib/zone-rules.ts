// Server-side helpers for public.delivery_zone_rules + public.delivery_zone_row_overrides.
//
// This module owns the DB shape (types), the fetch that hydrates a ZoneRuleSet
// for the resolver, and the server-side preview counters. Every call runs
// under service_role — RLS is enabled on both tables with zero policies, so
// the anon/authenticated key CANNOT read or write here.
//
// The preview counters are the reason this is a server module rather than a
// pure client one: a preview computed from the board's already-filtered rows
// understates the blast radius (a rule can move rows outside the visible day
// or status filter). The preview must be global.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EMPTY_RULE_SET,
  flattenSubscriptionAddress,
  normaliseLocalityKey,
  normalisePincodeKey,
  resolveZoneWithSource,
  type NumberedZone,
  type ZoneKey,
  type ZoneRuleSet,
} from "@/lib/delivery-zones";

// ---- row shapes ---------------------------------------------------------

export type ZoneRuleRow = {
  id: string;
  key_type: "pincode" | "locality";
  key_value: string;
  key_input: string;
  zone: NumberedZone;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ZoneRowOverrideRow = {
  id: string;
  order_id: string | null;
  subscription_id: string | null;
  zone: NumberedZone;
  created_by: string;
  created_at: string;
  updated_at: string;
};

const NUMBERED: readonly NumberedZone[] = ["zone1", "zone2", "zone3", "zone4"];

export function isNumberedZone(v: unknown): v is NumberedZone {
  return typeof v === "string" && (NUMBERED as readonly string[]).includes(v);
}

// ---- fetch --------------------------------------------------------------

/**
 * Load both tables into the shape the resolver expects. One round trip per
 * table, executed in parallel. Safe to call on every board render — the
 * whole payload is small (rules are dozens of rows at most, overrides are
 * fewer) and the resolver keeps its cache invalidation logic simple by
 * treating the returned bundle as a value.
 */
export async function fetchZoneRules(
  client: SupabaseClient,
): Promise<{ rules: ZoneRuleRow[]; overrides: ZoneRowOverrideRow[]; set: ZoneRuleSet }> {
  const [rulesRes, overridesRes] = await Promise.all([
    client
      .from("delivery_zone_rules")
      .select("id, key_type, key_value, key_input, zone, created_by, created_at, updated_at")
      .order("updated_at", { ascending: false }),
    client
      .from("delivery_zone_row_overrides")
      .select("id, order_id, subscription_id, zone, created_by, created_at, updated_at")
      .order("updated_at", { ascending: false }),
  ]);
  if (rulesRes.error) throw rulesRes.error;
  if (overridesRes.error) throw overridesRes.error;
  const rules = (rulesRes.data ?? []) as ZoneRuleRow[];
  const overrides = (overridesRes.data ?? []) as ZoneRowOverrideRow[];
  return { rules, overrides, set: buildRuleSet(rules, overrides) };
}

/** Assemble the four Maps the resolver consumes. Kept pure so tests can
 *  build a rule set without hitting a database. */
export function buildRuleSet(
  rules: ZoneRuleRow[],
  overrides: ZoneRowOverrideRow[],
): ZoneRuleSet {
  const set: ZoneRuleSet = {
    pincode: new Map(),
    locality: new Map(),
    rowByOrder: new Map(),
    rowBySubscription: new Map(),
  };
  for (const r of rules) {
    if (!isNumberedZone(r.zone)) continue;
    if (r.key_type === "pincode") set.pincode.set(r.key_value, r.zone);
    else if (r.key_type === "locality") set.locality.set(r.key_value, r.zone);
  }
  for (const o of overrides) {
    if (!isNumberedZone(o.zone)) continue;
    if (o.order_id) set.rowByOrder.set(o.order_id, o.zone);
    if (o.subscription_id) set.rowBySubscription.set(o.subscription_id, o.zone);
  }
  return set;
}

// ---- preview ------------------------------------------------------------

export type ZoneCountsByKey = Record<ZoneKey, number>;

const EMPTY_COUNTS = (): ZoneCountsByKey => ({
  zone1: 0,
  zone2: 0,
  zone3: 0,
  zone4: 0,
  unzoned: 0,
  pickup: 0,
});

/**
 * Global blast-radius preview. Scans all orders + subscriptions with the
 * CURRENT rule set, then resolves each row again with a HYPOTHETICAL rule
 * applied (upsert on `(keyType, keyValue)` → `nextZone`). Returns the
 * before/after zone distribution and the count of rows that moved.
 *
 * Called by the popover before the confirm dialog is shown. Deletion goes
 * through the same function with `nextZone=null` (rule removed).
 */
export async function previewRuleChange(
  client: SupabaseClient,
  input: {
    keyType: "pincode" | "locality";
    keyValue: string;
    /** `null` = deleting the rule (or the rule not existing yet). */
    nextZone: NumberedZone | null;
  },
): Promise<{
  before: ZoneCountsByKey;
  after: ZoneCountsByKey;
  moved: number;
  matchingRows: number;
}> {
  const { rules, overrides, set: current } = await fetchZoneRules(client);

  const nextRules = rules.filter(
    (r) => !(r.key_type === input.keyType && r.key_value === input.keyValue),
  );
  if (input.nextZone) {
    nextRules.push({
      id: "__preview__",
      key_type: input.keyType,
      key_value: input.keyValue,
      key_input: input.keyValue,
      zone: input.nextZone,
      created_by: "__preview__",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  const next = buildRuleSet(nextRules, overrides);

  const before = EMPTY_COUNTS();
  const after = EMPTY_COUNTS();
  let moved = 0;
  let matchingRows = 0;

  // Scan orders. Only fields the resolver needs; keep the payload thin.
  const { data: orderRows, error: orderErr } = await client
    .from("orders")
    .select("id, delivery_address, fulfillment_type");
  if (orderErr) throw orderErr;
  for (const o of (orderRows ?? []) as Array<{
    id: string;
    delivery_address: string | null;
    fulfillment_type: string | null;
  }>) {
    const b = resolveZoneWithSource(
      {
        address: o.delivery_address,
        isPickup: o.fulfillment_type === "pickup",
        orderId: o.id,
      },
      current,
    );
    const a = resolveZoneWithSource(
      {
        address: o.delivery_address,
        isPickup: o.fulfillment_type === "pickup",
        orderId: o.id,
      },
      next,
    );
    before[b.zone] += 1;
    after[a.zone] += 1;
    if (b.zone !== a.zone) moved += 1;
    // "matchingRows" = rows whose key would match this rule regardless of
    // whether they moved zone. That count answers "how many rows are keyed
    // on 530007?" and is what the operator understands the rule to cover;
    // `moved` is the more accurate "how many of those actually flip".
    if (rowMatchesKey(o.delivery_address, null, input.keyType, input.keyValue)) {
      matchingRows += 1;
    }
  }

  // Scan subscriptions. Address lives in customer_address + delivery_address
  // (jsonb) + customer_pincode.
  const { data: subRows, error: subErr } = await client
    .from("subscriptions")
    .select("id, customer_address, customer_pincode, delivery_address");
  if (subErr) throw subErr;
  for (const s of (subRows ?? []) as Array<{
    id: string;
    customer_address: string | null;
    customer_pincode: string | null;
    delivery_address: {
      line1?: string | null;
      line2?: string | null;
      city?: string | null;
      pincode?: string | null;
    } | null;
  }>) {
    const address = flattenSubscriptionAddress({
      customer_address: s.customer_address,
      delivery_address: s.delivery_address,
    });
    const b = resolveZoneWithSource(
      { address, pincode: s.customer_pincode, subscriptionId: s.id },
      current,
    );
    const a = resolveZoneWithSource(
      { address, pincode: s.customer_pincode, subscriptionId: s.id },
      next,
    );
    before[b.zone] += 1;
    after[a.zone] += 1;
    if (b.zone !== a.zone) moved += 1;
    if (rowMatchesKey(address, s.customer_pincode, input.keyType, input.keyValue)) {
      matchingRows += 1;
    }
  }

  return { before, after, moved, matchingRows };
}

// EMPTY_RULE_SET is exported so tests and offline scripts can call
// resolveZoneWithSource() without a database.
export { EMPTY_RULE_SET };

// ---- helpers ------------------------------------------------------------

function rowMatchesKey(
  address: string | null | undefined,
  explicitPin: string | null | undefined,
  keyType: "pincode" | "locality",
  keyValue: string,
): boolean {
  if (keyType === "pincode") {
    const target = normalisePincodeKey(keyValue);
    if (!target) return false;
    const explicit = normalisePincodeKey(explicitPin);
    if (explicit === target) return true;
    const text = (address ?? "").toString();
    const re = new RegExp(`\\b${target}\\b`);
    return re.test(text);
  }
  // locality — cheap contains check on the normalised string. Not word-
  // boundaried here because it feeds a count, not the zone decision.
  const target = normaliseLocalityKey(keyValue);
  if (!target) return false;
  const text = normaliseLocalityKey(address ?? "");
  return text.includes(target);
}
