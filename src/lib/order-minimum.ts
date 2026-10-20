// The 2-item floor on NEW one-time orders.
//
// WHY THIS IS NOT A PER-LINE CHECK. Both request validators already bound
// each line (`QTY_MIN`..`QTY_MAX` in order-validation.ts), and a per-line
// floor would reject one loaf + one bun — a perfectly good two-item order.
// The floor is on the CART TOTAL, which nothing computed before this module:
// the `totalUnits` variables elsewhere in the codebase all belong to
// subscription code building `quantity_per_delivery`.
//
// THE QUANTITY KEY DIFFERS BY CLIENT, so this module never reads one itself.
// `orders.items` and the two request bodies between them use `qty` (website)
// and `quantity` (app), which is why the sum goes through `itemQty` from
// order-items.ts — see that file's header for the measured cost of reading
// one key and not the other. A floor that silently counts half the carts is
// worse than no floor, because it reads as enforced.
//
// WHY A SUBSCRIPTION LINE EXEMPTS THE WHOLE CART. The website posts the
// ENTIRE cart to `place_order` and only fans subscriptions out afterwards
// (checkout/page.tsx — `orderItems` is built from every non-sandwich line,
// and `submitSubscriptions` runs after the order call returns). So a refusal
// here does not just block the one-time half of a mixed cart: it returns
// before the subscription requests are ever sent, and takes the
// subscription down with it. A subscription customer adding a single loaf
// to the same basket has not asked for a one-time order worth gating, and
// subscriptions carry their own rules. Hence: any `sub` line present ⇒ this
// floor does not apply. The app never sends a mixed cart (its subscriptions
// go to /api/mobile/subscriptions and `validateOrderBodyShape` has no
// `kind` field at all), so an absent `kind` correctly counts as one-time.

import { itemQty, type OrderItemLike } from "./order-items";

/** Minimum items on a new one-time order. Two of the SAME product counts —
 *  the floor is on units, not on distinct lines. */
export const MIN_ONE_TIME_UNITS = 2;

/** Machine-readable reason. Checked against every code the Android app
 *  branches on before being chosen: it collides with none, so the app falls
 *  through to its generic handler and shows `error` verbatim. */
export const ONE_TIME_MINIMUM_CODE = "one_time_minimum_units";

/**
 * The customer-facing refusal.
 *
 * MUST CARRY ITS OWN REMEDY. On Android this surfaces in the error banner on
 * the PAYMENT step — the last one — because the installed app has no
 * client-side floor to stop the customer earlier, and it cannot get one
 * without a Play release. The app appends "Please return to the cart…" only
 * for `price_mismatch` / `product_unavailable`; every other code is rendered
 * as-is. So the sentence has to say what to do without any help from the UI
 * around it.
 *
 * "items", not "loaves": buns and pizza bases count toward the floor.
 * The count is interpolated so there is one source of truth, and the test
 * pins this sentence byte-for-byte — raising MIN_ONE_TIME_UNITS will fail
 * that test, which is the point. "Add one more" is only true for a shortfall
 * of exactly one, and a shortfall of one is all a floor of two can produce.
 */
export const ONE_TIME_MINIMUM_MESSAGE =
  `One-time orders need at least ${MIN_ONE_TIME_UNITS} items. Add one more to your cart to continue.`;

/** A cart line as seen by this module: any of the quantity keys, plus the
 *  website's one-time/subscription discriminator. `kind` is `unknown`
 *  because it is absent on the app's shape and jsonb promises nothing. */
export type MinimumCartLine = OrderItemLike & { kind?: unknown };

/**
 * True when the cart contains a subscription line, i.e. when this floor
 * does not apply. Exact `"sub"` match — both the request validator
 * (`validateWebOrderItemsShape`) and the stored snapshot
 * (`reconcileWebPrices`) write that literal, so there is no casing to
 * normalise and a surprising value should NOT be read as a subscription.
 */
export function carriesSubscriptionLine(
  items: readonly MinimumCartLine[],
): boolean {
  return items.some((it) => it?.kind === "sub");
}

/**
 * Total units across every line, via the shared quantity reader.
 *
 * Not filtered by `kind` — callers only reach this once
 * `carriesSubscriptionLine` is false, at which point every line is
 * one-time and a filter would be a second place to get the rule wrong.
 */
export function totalCartUnits(items: readonly MinimumCartLine[]): number {
  return items.reduce((sum, it) => sum + itemQty(it), 0);
}

/**
 * The gate. Returns a ready-to-serialise failure, or null when the order
 * may proceed.
 *
 * NEW ORDERS ONLY. Never call this from an edit, a payment verification or
 * the webhook: re-validating an existing row would refuse money already
 * taken and strand orders placed under the older rule. Admin and team-PIN
 * entry is exempt at its call site, not here — an operator recording a real
 * single-item sale must not be blocked by a storefront rule.
 */
export function belowOneTimeMinimum(
  items: readonly MinimumCartLine[],
): { status: number; error: string; code: string } | null {
  if (carriesSubscriptionLine(items)) return null;
  if (totalCartUnits(items) >= MIN_ONE_TIME_UNITS) return null;
  return {
    status: 400,
    error: ONE_TIME_MINIMUM_MESSAGE,
    code: ONE_TIME_MINIMUM_CODE,
  };
}
