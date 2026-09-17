// The admin search box's matcher, for every board that has one.
//
// One function rather than one per board, for the same reason order-filter.ts
// is shared: a search that behaves differently on two boards is a search the
// operator cannot trust. They type a phone number, get nothing, and have no
// way to tell whether the customer is absent or the box is just weaker here.
//
// WHAT THE OPERATOR IS ACTUALLY TYPING. Almost always something read aloud
// over a phone call, or off a bag, which is why this is not a plain substring
// test:
//
//   - A customer only ever knows `public_ref` ("CX-7K4M2P") and will read it
//     without the prefix, or without the hyphen, or both.
//   - `order_number` ("OLF43", legacy "CDX-00006") is what is on the bag.
//   - Phone numbers get typed with or without separators and with or without
//     the country code.
//
// So each field is tested twice: once verbatim, and once with the reference
// punctuation stripped from BOTH sides. The stripped pass is skipped when it
// would leave an empty needle — typing "cx-" must not match every row that
// has a reference.

/**
 * `fields` is whatever the caller considers searchable for that row — name,
 * phone, and any references. Nulls are skipped, so a caller can pass an
 * optional column straight through without a guard.
 *
 * An empty or whitespace-only query matches EVERYTHING. The caller is
 * filtering a list, and "no search" is not "no results".
 */
export function matchesAdminQuery(
  rawQuery: string,
  fields: readonly (string | null | undefined)[],
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const bareQ = stripRefPunctuation(q);
  for (const field of fields) {
    if (!field) continue;
    const v = field.toLowerCase();
    if (v.includes(q)) return true;
    if (bareQ.length > 0 && stripRefPunctuation(v).includes(bareQ)) return true;
  }
  return false;
}

/** Drop a leading `cx` reference prefix (with or without its hyphen) and
 *  every hyphen after it. Applied to both sides so "cx 7k4-m2p" typed badly
 *  still finds `CX-7K4M2P`. */
function stripRefPunctuation(s: string): string {
  return s.replace(/^cx-?/, "").replace(/-/g, "");
}
