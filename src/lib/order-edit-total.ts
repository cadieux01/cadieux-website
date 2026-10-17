// Which figure, if any, an admin order edit may post for `total_amount`.
//
// WHY THIS IS NOT `effectiveTotal !== storedTotal`. The edit panel re-derives
// a total from its own draft state on every render, so a bare difference test
// fires whenever the draft disagrees with the row — including when the
// operator never touched the money. A draft that is MISSING a figure the row
// actually has therefore re-prices the order on a save that was only ever
// about the delivery date.
//
// That is not hypothetical: the orders-list projection omitted delivery_fee,
// `order.delivery_fee ?? 0` read the absent column as a real zero, and every
// "Edit date & time" save from the board posted an items-only total. Per the
// audit log, edits between 3 and 17 Oct moved live orders' totals down by
// exactly their delivery fee — some of them paid, and the fee column kept the
// right value the whole time, so the row disagreed with itself rather than
// looking wrong.
//
// The projection is fixed too, but a money write gated only on "does it
// differ" stays one absent column away from doing this again, and the absent
// column type-checks (`delivery_fee?: number | null`). So the gate here is
// INTENT, not difference: the total moves only when the operator changed an
// input the total is MADE of. A date, a slot and an address cannot move money.
//
// Returns the figure to post, or null for "leave total_amount alone". Null is
// not an error — it is the normal answer for a date-only edit, and it also
// keeps the server's money-delta note from firing, since that note is gated on
// total_amount being present in the body.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function totalAmountToPost(input: {
  /** Items are actually being posted — i.e. changed AND not locked by payment.
   *  A locked paid order holds a draft nobody can submit; it must not move
   *  money either. */
  itemsPosted: boolean;
  /** The delivery fee input differs from the stored fee. */
  feeChanged: boolean;
  /** The operator ticked "override total" and typed a figure. Explicit intent,
   *  so it counts on its own — this is the one path that may post a total with
   *  no items or fee change behind it. */
  totalOverridden: boolean;
  /** The panel's current figure: derived items + fee, or the override. */
  effectiveTotal: number;
  /** `orders.total_amount` as loaded. */
  storedTotal: number;
}): number | null {
  const moneyTouched =
    input.itemsPosted || input.feeChanged || input.totalOverridden;
  if (!moneyTouched) return null;

  const next = round2(input.effectiveTotal);
  // Still suppress a no-op: the server rejects a body whose every field
  // matches the row, and an unchanged total must not fetch a money-delta note.
  if (next === round2(input.storedTotal)) return null;

  return next;
}
