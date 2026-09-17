// Delivery zones — the ONE map, the ONE resolver.
//
// Both admin boards (orders + subscriptions), the print sheet and the
// share composer read zones from here so the badge on a row, the group
// heading on the sheet and the option in the filter dropdown cannot
// disagree. Zone is derived from the address at read time; NOTHING is
// written back to the database — no column, no migration.
//
// EDIT ONE PLACE: extend `ZONE_DEFS` below. That is the map. Aliases
// (case-insensitive alternate spellings) live in `LOCALITY_ALIASES`.
//
// RESOLUTION ORDER (first match wins — this is why pickup can't be a
// locality and pincode outranks name):
//   1. PICKUP     address starts "Pick up" OR contains "dark store".
//   2. PINCODE    the first 6-digit run in the address, matched against
//                 the pincode list in each zone.
//   3. LOCALITY   case-insensitive, whole-word (`(?:^|[^a-z0-9])name…`)
//                 match against the locality list. Aliases fold into
//                 the canonical spelling before the check.
//   4. UNZONED    the honest bucket. Live pincodes with no assignment
//                 (530004/530005/530007/530011/530018/530043/531162 …)
//                 land here. It is a real zone in the filter with a
//                 real count — the operator must be able to SEE the
//                 rows that fell through, or the map cannot be tuned.
//
// Verified against 242 live orders on 2026-09-16:
//   pickup 51 · zone1 45 · zone2 64 · zone3 51 · zone4 8 · unzoned 23
//   sum = 242, no double count.

export type ZoneKey =
  | "zone1"
  | "zone2"
  | "zone3"
  | "zone4"
  | "unzoned"
  | "pickup";

/** Fixed display order for the filter menu, print groups and the strip. */
export const ZONE_KEYS: readonly ZoneKey[] = [
  "zone1",
  "zone2",
  "zone3",
  "zone4",
  "unzoned",
  "pickup",
];

export const ZONE_LABELS: Record<ZoneKey, string> = {
  zone1: "Zone 1",
  zone2: "Zone 2",
  zone3: "Zone 3",
  zone4: "Zone 4",
  unzoned: "Unzoned",
  pickup: "Pickup",
};

/** THE MAP. Extend this — nothing else — when a locality is added. */
type ZoneDef = {
  key: Exclude<ZoneKey, "unzoned" | "pickup">;
  pincodes: string[];
  localities: string[];
};

const ZONE_DEFS: ZoneDef[] = [
  {
    key: "zone1",
    pincodes: ["530045", "530041", "530048"],
    localities: [
      "Bheemili",
      "Madhurwada",
      "Midhilapuri",
      "Kommadhi",
      "P.M.palem",
      "Rushikonda",
      "Yendada",
      "Sagar nagar",
    ],
  },
  {
    key: "zone2",
    pincodes: ["530003", "530013", "530016", "530040"],
    localities: [
      "Arilova",
      "Simhachalam",
      "Pendurthi",
      "Gopalapatnam",
      "NAD",
      "Kancharapalem",
      "Tatchetlapalem",
      "Akkayapalem",
      "Seethammadhara",
      "HB Colony",
      "Maddilapalem",
    ],
  },
  {
    key: "zone3",
    pincodes: ["530017", "530002"],
    localities: [
      "Kailasagiri",
      "MVP",
      "Chinnawaltair",
      "Maharani peta",
      "Jagadamba",
      "Dabagardens",
      "Complex",
      "Dwarakanagar",
      "VIP road",
    ],
  },
  {
    key: "zone4",
    pincodes: ["530026", "530012"],
    localities: [
      "Old VSKP airport",
      "Sheela nagar",
      "Steel plant",
      "Autonagar",
      "Gajuwaka",
      "Kurmanapalem",
      "Duvvada",
      "Dolphin hill",
    ],
  },
];

/** Alternate spellings folded into the canonical locality above. Keys
 *  and values BOTH match case-insensitively. Live example: the checkout
 *  autocomplete offers "Akkayyapalem" (two y's), the postal spelling is
 *  "Akkayapalem" — the alias means one entry in `ZONE_DEFS` is enough. */
const LOCALITY_ALIASES: Record<string, string> = {
  akkayyapalem: "Akkayapalem",
  madhurawada: "Madhurwada",
  kommadi: "Kommadhi",
  "pothinamallayya palem": "P.M.palem",
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const PINCODE_TO_ZONE: Record<string, ZoneKey> = (() => {
  const map: Record<string, ZoneKey> = {};
  for (const def of ZONE_DEFS) {
    for (const pin of def.pincodes) map[pin] = def.key;
  }
  return map;
})();

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Precompiled `(zoneKey, regex)` pairs for locality matching.
 *  Word-ish boundaries: any non-alphanumeric on either side (or start/end).
 *  Handles periods in "P.M.palem" and spaces in "Sagar nagar" alike. */
const LOCALITY_MATCHERS: { key: ZoneKey; re: RegExp }[] = (() => {
  const out: { key: ZoneKey; re: RegExp }[] = [];
  const push = (key: ZoneKey, name: string) => {
    const re = new RegExp(
      `(?:^|[^a-z0-9])${escapeRegex(name.toLowerCase())}(?=[^a-z0-9]|$)`,
      "i",
    );
    out.push({ key, re });
  };
  for (const def of ZONE_DEFS) {
    for (const name of def.localities) push(def.key, name);
  }
  // Aliases fold to the SAME zone as their canonical target. Look up the
  // zone at build time so a bad alias (canonical missing from the map)
  // fails loudly here rather than silently returning "unzoned".
  for (const [alias, canonical] of Object.entries(LOCALITY_ALIASES)) {
    const owner = ZONE_DEFS.find((d) =>
      d.localities.some((l) => l.toLowerCase() === canonical.toLowerCase()),
    );
    if (!owner) {
      throw new Error(
        `[delivery-zones] alias '${alias}' → '${canonical}' has no zone`,
      );
    }
    push(owner.key, alias);
  }
  return out;
})();

const PICKUP_HINTS = /(^\s*pick\s*up\b)|(\bdark\s*store\b)/i;

/** Every 6-digit run in the string. Word-boundaried so a stray "5300000"
 *  doesn't slice out a fake pin, and so a phone number like `9700330030`
 *  doesn't get read as `700330`. Returns MULTIPLE hits in source order —
 *  Vizag addresses often start with a 6-digit door number ("234455 Seetamma
 *  Peta Main Road, … 530016") and the postal pin sits at the end. The
 *  resolver tries them in order and takes the first one that lands in the
 *  map, so a bogus door number does not shadow the real pin. */
function extractPincodes(s: string): string[] {
  const out: string[] = [];
  const re = /\b(\d{6})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(m[1]);
  return out;
}

// ---------------------------------------------------------------------------
// The public resolver — takes STRINGS, not a row type. Both boards adapt
// their own row into these arguments; the module never sees an AdminOrderRow
// or an AdminSubscriptionRow, so a change in either row shape leaves it
// alone.
// ---------------------------------------------------------------------------

export type ZoneInputs = {
  /** The primary address text to search. For orders this is
   *  `delivery_address`. For subscriptions this is `customer_address` or
   *  the concatenated `delivery_address` jsonb. */
  address?: string | null;
  /** An explicit pincode to check FIRST, before extracting one from the
   *  address text. Subscriptions have `customer_pincode` as its own
   *  column and it is more trustworthy than a stray 6-digit run. */
  pincode?: string | null;
};

/**
 * Return the zone key for a delivery address.
 *
 * `pickup` never comes from an address; the caller decides pickup-ness
 * from the row (`fulfillment_type === 'pickup'`) and passes that in via
 * {@link resolveZoneWithPickup}. This function alone honours the pickup
 * hint in text ("Pick up …" / "dark store") for orders which never had
 * a fulfillment_type set.
 */
export function resolveZone(inputs: ZoneInputs): ZoneKey {
  const address = (inputs.address ?? "").trim();
  const explicit = (inputs.pincode ?? "").trim();

  if (address && PICKUP_HINTS.test(address)) return "pickup";

  if (explicit && PINCODE_TO_ZONE[explicit]) return PINCODE_TO_ZONE[explicit];
  for (const pin of extractPincodes(address)) {
    if (PINCODE_TO_ZONE[pin]) return PINCODE_TO_ZONE[pin];
  }

  if (address) {
    for (const { key, re } of LOCALITY_MATCHERS) {
      if (re.test(address)) return key;
    }
  }

  return "unzoned";
}

/**
 * Same as {@link resolveZone} but with an explicit pickup escape hatch —
 * subscriptions don't ship as pickup so they never pass true, orders
 * pass `fulfillment_type === 'pickup'`.
 */
export function resolveZoneWithPickup(
  inputs: ZoneInputs & { isPickup?: boolean },
): ZoneKey {
  if (inputs.isPickup) return "pickup";
  return resolveZone(inputs);
}

/** Convenience for the subscriptions board: flattens the jsonb address
 *  and passes `customer_pincode` as the explicit pin. */
export function flattenSubscriptionAddress(input: {
  customer_address?: string | null;
  delivery_address?: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    pincode?: string | null;
  } | null;
}): string {
  const da = input.delivery_address;
  const parts = [
    da?.line1,
    da?.line2,
    da?.city,
    da?.pincode,
    input.customer_address,
  ]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  return parts.join(", ");
}
