/**
 * DECISION — 2026-09-14, Sunny. THE CUSTOMER-FACING NUMBER IS NOW OLS/SLF.
 *
 *   orders        → OLS1, OLS2, …   (public.orders_number_seq)
 *   subscriptions → SLF1, SLF2, …   (public.subscriptions_number_seq)
 *
 * Sunny's words: "SLF for the subscription orders, OLS for the normal orders."
 *
 * Until this date customers were shown `public_ref` (CX-7K4M2P) and the
 * sequential number was withheld, because it discloses cumulative volume, and
 * the difference between two of a customer's own orders discloses the growth
 * rate in between.
 *
 * That disclosure is real, and the renumber on 2026-09-14 made it SHARPER, not
 * weaker. Before, one counter was shared across both tables, so a number only
 * ever leaked combined order + subscription throughput. Now the two series are
 * separate and each was restarted at 1 with no gaps, so OLS<n> states the exact
 * number of orders ever taken and SLF<n> the exact number of subscriptions.
 *
 * It was put to Sunny explicitly, with the example, and he overruled it on
 * operational grounds: he could not hold a conversation with a customer about
 * an order while the two of them were looking at different numbers, and that
 * cost is paid every single day, whereas the volume signal is diffuse and of
 * interest to almost nobody.
 *
 * So: if you are reading this and about to "restore" the guard — it was not an
 * oversight, and it is not a bug. Take it up with Sunny, not with the code.
 *
 * WHAT DID NOT CHANGE, and must not:
 *   - URLs still key on the order UUID. Nothing resolves an order by its OLS
 *     number, and nothing should. An OLS resolver would be an enumerable
 *     endpoint (OLS200, OLS201, …) over names, phones and addresses — the
 *     sequential property that is merely untidy in a display is a real hole in
 *     a lookup key, and it is now perfectly dense from 1. The phone-verification
 *     gate on /api/orders/[id] is what actually protects the data, but do not
 *     hand out a free walk.
 *   - `public_ref` is still assigned, still stored, still projected. Admin
 *     search resolves both, because customers holding an older SMS will quote
 *     a CX- code for as long as those messages exist.
 */

/**
 * Central formatter for the human-facing order number.
 *
 * The DB trigger `orders_assign_number` (public.tg_orders_assign_number)
 * assigns `order_number` = 'OLS' || nextval('public.orders_number_seq') on
 * every BEFORE INSERT — atomic, collision-safe, monotonic, no digit cap, no
 * leading zeros (OLS1, OLS2, … OLS10, … OLS1000).
 *
 * As of the 2026-09-14 renumber every row carries an OLS number: the table was
 * rewritten to a gapless 1..N ordered by `created_at`, and the earlier NULL and
 * `CDX-#####` rows no longer exist. That was a one-off. We do NOT renumber
 * again — a customer who has been told a number must keep it.
 *
 * The helper is prefix-agnostic: it renders whatever is in the column. The
 * UUID-slice fallback (`#D5ED04D6`) should therefore never fire on a full row;
 * it exists so a partial API projection cannot render "undefined" at a
 * customer, and so the mobile app can talk to a server older than itself.
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
 * Central formatter for the human-facing SUBSCRIPTION number.
 *
 * `public.tg_subscriptions_assign_number` (BEFORE INSERT) assigns
 * `subscription_number` = 'SLF' || nextval('public.subscriptions_number_seq').
 *
 * Until 2026-09-14 subscriptions drew from `orders_number_seq`, the SAME
 * counter as orders, so one interleaved series ran across both tables and a
 * gap in `orders.order_number` was a subscription, not corruption. The
 * renumber SPLIT them: two counters, two prefixes, each restarted at 1.
 * Collision safety no longer comes from sharing a counter — it comes from the
 * prefixes, which is why SLF and OLS must stay distinct. Do not "tidy" one of
 * them into the other.
 *
 * Same fallback as `formatOrderNumber`, and for the same reason: it should
 * never fire on a full row, but a partial API projection must not render
 * "undefined" onto a rider's share message.
 *
 * Customer-facing as of 2026-09-14 — see the decision note at the top of this
 * file.
 */
export function formatSubscriptionNumber(row: {
  id: string;
  subscription_number?: string | null;
}): string {
  const n =
    typeof row.subscription_number === "string"
      ? row.subscription_number.trim()
      : "";
  if (n.length > 0) return n;
  return "#" + row.id.slice(0, 8).toUpperCase();
}

/**
 * Central formatter for the CUSTOMER-facing order reference.
 *
 * `public_ref` = 'CX-' + 6 chars drawn from a 30-char alphabet with
 * 0/O/1/I/L/U removed, so it survives being read out over the phone.
 * Assigned by the same BEFORE INSERT trigger, but drawn at random from
 * pgcrypto — NOT from orders_number_seq.
 *
 * NO LONGER SHOWN TO CUSTOMERS as of 2026-09-14 (see the decision note at the
 * top of this file). Retained for one reason: older confirmation SMS and
 * WhatsApp messages are already delivered and unchangeable, so a customer may
 * quote a CX- code for years. Admin search must keep resolving it. Do not use
 * this helper on a new customer surface — use `formatOrderNumber`.
 *
 * The prefix is 'CX-', not 'CDX-', because six legacy `order_number` values
 * were 'CDX-00001'…'CDX-00006' at the time and two different CDX references
 * would have been ambiguous read out over the phone. Those rows were
 * renumbered on 2026-09-14, but the choice stands.
 *
 * Surviving call sites are admin-only: the packing slip prints it beside the
 * OLS number, and admin order search matches against it.
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
