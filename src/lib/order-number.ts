/**
 * Central formatter for the human-facing order number.
 *
 * The DB trigger `orders_assign_number` (public.tg_orders_assign_number)
 * assigns `order_number` = 'OLF' || nextval('orders_number_seq') on every
 * BEFORE INSERT — atomic, collision-safe, monotonic, no digit cap, no
 * leading zeros (OLF1, OLF2, … OLF10, … OLF1000).
 *
 * Historical rows (created before the trigger was installed on
 * 2026-07-14) have `order_number = NULL`; a middle batch of 6 rows
 * carries the previous `CDX-#####` format from the initial trigger.
 * Both are preserved verbatim — we NEVER back-fill or reformat.
 *
 * All customer + admin display surfaces should call this helper instead
 * of `id.slice(0, 8)` so:
 *   - New rows show `OLF7`, `OLF8`, …
 *   - Legacy CDX rows show `CDX-00001` … `CDX-00006`
 *   - Truly-legacy NULL rows fall back to `#D5ED04D6` (the old UUID slice
 *     format, so existing links / prints stay recognisable)
 */
export function formatOrderNumber(row: {
  id: string;
  order_number?: string | null;
}): string {
  const n = typeof row.order_number === "string" ? row.order_number.trim() : "";
  if (n.length > 0) return n;
  return "#" + row.id.slice(0, 8).toUpperCase();
}

/**
 * Central formatter for the CUSTOMER-facing order reference.
 *
 * `public_ref` = 'CX-' + 6 chars drawn from a 30-char alphabet with
 * 0/O/1/I/L/U removed, so it survives being read out over the phone.
 * Assigned by the same BEFORE INSERT trigger, but drawn at random from
 * pgcrypto — NOT from orders_number_seq. That is the whole point:
 * `order_number` (OLF43) discloses cumulative order volume and the
 * growth rate between any two orders; `public_ref` discloses nothing.
 *
 * The prefix is 'CX-', not 'CDX-', because six legacy `order_number`
 * values are already 'CDX-00001'…'CDX-00006' and two different CDX
 * references would be ambiguous read out over the phone.
 *
 * Use this on every surface a customer can see. `formatOrderNumber`
 * (OLF) stays on admin, print, delivery and rider surfaces.
 *
 * The column is NOT NULL and every historical row was backfilled, so
 * the UUID-slice fallback should never fire — it exists only so a
 * partial API projection can't render "undefined" to a customer.
 */
export function formatPublicRef(row: {
  id: string;
  public_ref?: string | null;
}): string {
  const r = typeof row.public_ref === "string" ? row.public_ref.trim() : "";
  if (r.length > 0) return r;
  return "#" + row.id.slice(0, 8).toUpperCase();
}
