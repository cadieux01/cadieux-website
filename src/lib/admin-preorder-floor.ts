// Server-side pre-order floor gate for the two admin EDIT writers:
//   /api/admin/orders/[id]/edit
//   /api/admin/subscriptions/[id]/deliveries/[deliveryId]
//
// Both panels already warned about `products.available_from` and both made
// the operator press Acknowledge — and that button did nothing but unlock a
// client-side `if`. The server accepted the date either way, so the warning
// was advice, not a gate, and anything that is not the panel (curl, a
// replayed request, a future screen) never saw it at all.
//
// WHY AN OVERRIDE EXISTS HERE AND NOT ON CREATE. The creation writers refuse
// flat (see /api/admin/subscriptions/create step 7a): nothing is booked yet,
// so the honest answer is "pick a later date, or clear the floor". These two
// routes edit a row that ALREADY EXISTS, and an operator moving an existing
// delivery is often reacting to something the column does not know — a
// customer who agreed to wait, a bake that came in early. Refusing outright
// would make the only way forward an UPDATE to products, which changes the
// rule for every customer in order to serve one.
//
// So the override is honoured, and AUDITED. A bypass nobody can find later
// is the same as no rule: the next person to ask "why did OLF212 go out two
// days before the loaf existed?" must be able to answer it from `audit_log`,
// not from reading this file. The row is QUEUED, through `queueAuditEvent`,
// rather than left as a floating promise: Vercel freezes the invocation the
// instant the response is returned, so the record of the bypass would itself
// be a coin flip. That helper carries the measurement and the reasoning.
//
// Query the bypasses with:
//   select occurred_at, entity, target_label, context, meta
//     from audit_log
//    where meta->>'preorder_floor_override' = 'true'
//    order by occurred_at desc;
//
// Filter on THAT, not on `action` — `other` is a coarse bucket shared with
// everything else that does not fit the verb list.

import "server-only";

import type { NextRequest } from "next/server";

import { supabaseAdmin } from "@/lib/admin-auth";
import { queueAuditEvent, type AuditEntity } from "@/lib/audit-log";
import { enforceDeliveryFloor } from "@/lib/order-validation";
import { cartFloor, type AvailabilityRow } from "@/lib/product-availability";

/** The two keys an item line can carry to name its product. Both are
 *  optional on every stored shape in the tree (AdminOrderItemSnapshot,
 *  subscription_items rows, items_override entries), so both are optional
 *  here. A line with neither resolves to nothing — see the fail-open note on
 *  `resolveFloorRows`. */
export type FloorItemKey = {
  slug?: string | null;
  product_id?: string | null;
};

type ProductFloorRow = {
  id: string | null;
  slug: string | null;
  name: string | null;
  available_from: string | null;
  stock_message: string | null;
};

/** What the gate decided. `ok: false` carries a body the route can return
 *  verbatim; the shape matches ValidationFailure so the two read the same at
 *  the call site. */
export type FloorGuardResult =
  | { ok: true }
  | { ok: false; status: number; error: string; code: string };

const OK: FloorGuardResult = { ok: true };

/**
 * Resolve item lines to the products rows the floor is computed from.
 *
 * MATCHED ON BOTH COLUMNS — `slug` against products.slug AND `product_id`
 * against products.id — which is what both panels already do. On prod today
 * products.id and products.slug hold the same string on all six rows, so
 * either key alone appears to work; that is a coincidence of the data, not
 * something the schema enforces, and nothing stops a future row having
 * id != slug. Keying on slug alone would also silently skip the 24 orders
 * whose lines carry a product_id and no slug.
 *
 * UNFILTERED SELECT, deliberately. Building an `.or(slug.in.(…),id.in.(…))`
 * means interpolating stored item strings into PostgREST filter syntax. The
 * products table is six rows; reading all of it is cheaper than getting that
 * quoting right, and /api/admin/products/availability already reads it whole
 * for the same feature.
 *
 * FAILS OPEN, AND SAYS SO EVERY TIME. A line that matches no product row is
 * skipped rather than treated as floored — refusing an edit because an item
 * shape drifted would block work on an order that may have nothing to do
 * with a pre-order. There are ZERO such lines on prod today: no order has a
 * line with neither key, and no order carries a slug that is missing from
 * products. The log line is the point. If it ever appears, the item shape
 * has changed and this resolver needs updating — it is not a reason to
 * loosen the gate.
 */
async function resolveFloorRows(
  items: FloorItemKey[],
  logTag: string,
): Promise<AvailabilityRow[]> {
  const { data, error } = await supabaseAdmin
    .from("products")
    .select("id, slug, name, available_from, stock_message");

  if (error) {
    // Also fail open, for the same reason and with the same obligation to
    // be loud: an availability read that is down must not take every admin
    // edit down with it.
    console.error(`[${logTag}] floor products read failed:`, error.message);
    return [];
  }

  const rows = (data ?? []) as ProductFloorRow[];
  const out: AvailabilityRow[] = [];
  for (const it of items) {
    const slug = typeof it.slug === "string" ? it.slug : null;
    const productId = typeof it.product_id === "string" ? it.product_id : null;
    const match = rows.find(
      (p) =>
        (slug !== null && p.slug === slug) ||
        (productId !== null && p.id === productId),
    );
    if (!match) {
      console.warn(
        `[${logTag}] floor check could not resolve item`,
        { slug, product_id: productId },
      );
      continue;
    }
    out.push({
      name: match.name ?? match.slug ?? "This product",
      available_from: match.available_from,
      stock_message: match.stock_message,
    });
  }
  return out;
}

/**
 * The gate. Returns `{ ok: true }` when the date clears every line's floor,
 * when the caller honoured an override (having written the audit row), or
 * when there is nothing to check.
 *
 * CALL IT ONLY WHEN THE DATE OR THE ITEMS ACTUALLY MOVED. An order can sit
 * below a floor for reasons that pre-date this gate; refusing an unrelated
 * address edit on such a row would make the floor a lock on the whole record
 * rather than a check on the thing being changed.
 */
export async function guardPreorderFloor(opts: {
  req: NextRequest;
  items: FloorItemKey[];
  /** The date the row will hold AFTER this edit. */
  deliveryDate: string | null | undefined;
  /** `floor_override: true` in the request body — the Acknowledge press. */
  override: boolean;
  entity: AuditEntity;
  targetId: string;
  /** OLF / OLS code. Appears in the audit row and nowhere else. */
  targetLabel: string;
  logTag: string;
}): Promise<FloorGuardResult> {
  if (!opts.deliveryDate) return OK;
  if (opts.items.length === 0) return OK;

  const rows = await resolveFloorRows(opts.items, opts.logTag);
  if (rows.length === 0) return OK;

  const failure = enforceDeliveryFloor(rows, opts.deliveryDate);
  if (!failure) return OK;

  if (!opts.override) {
    return {
      ok: false,
      status: failure.status,
      error: failure.error,
      code: failure.code ?? "preorder_floor",
    };
  }

  // Honoured. `cartFloor` is re-run rather than threaded out of
  // enforceDeliveryFloor because the audit row needs the floor DATE and the
  // NAMES, and the gate only returns a finished English sentence. Both are
  // pure functions over the same rows, so they cannot disagree.
  const floor = cartFloor(rows);
  queueAuditEvent({
    req: opts.req,
    entity: opts.entity,
    // `other`, not `update`: the edit itself already writes its own `update`
    // row. This one records the RULE that was crossed, and burying it among
    // the ~54 ordinary update rows is how it would stop being findable.
    action: "other",
    targetId: opts.targetId,
    targetLabel: opts.targetLabel,
    context: `Pre-order floor overridden: ${opts.targetLabel} set to ${opts.deliveryDate}, but ${floor.names.join(", ")} is not available until ${floor.date}`,
    meta: {
      preorder_floor_override: true,
      delivery_date: opts.deliveryDate,
      floor_date: floor.date,
      products: floor.names,
    },
  });

  return OK;
}
