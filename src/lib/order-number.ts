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
