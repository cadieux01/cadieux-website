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

/**
 * The area names a human picks from, per numbered zone — the 36 localities
 * in `ZONE_DEFS`, read straight off the map rather than retyped.
 *
 * Added for the partner deliveries board, which offers an area picker under
 * each zone. It is DERIVED, never a second list: adding a locality to
 * `ZONE_DEFS` puts it in the picker with no other edit, which is the whole
 * point of "EDIT ONE PLACE" at the top of this file. It is deliberately NOT
 * sourced from `service_areas` — that table is a different catalogue (118
 * rows) and offering its names would list areas this resolver cannot match.
 *
 * Aliases are deliberately EXCLUDED. `LOCALITY_ALIASES` exists so a drifting
 * checkout spelling still resolves; surfacing "Madhurawada" and "Madhurwada"
 * as two pickable areas would imply they are two places and split one zone's
 * list in two. The resolver folds them together, so picking the canonical
 * name matches rows written either way.
 *
 * `unzoned` and `pickup` are absent BY CONSTRUCTION, not by omission — a row
 * is unzoned precisely because nothing in this map matched it, so there is no
 * area name to offer. A caller must say that rather than render an empty menu.
 */
export const ZONE_AREAS: Readonly<Record<NumberedZone, readonly string[]>> =
  Object.freeze(
    ZONE_DEFS.reduce(
      (acc, def) => {
        acc[def.key] = Object.freeze([...def.localities]);
        return acc;
      },
      {} as Record<NumberedZone, readonly string[]>,
    ),
  );

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
 *  Handles periods in "P.M.palem" and spaces in "Sagar nagar" alike.
 *
 *  The same pass fills `AREA_MATCHERS` below — canonical area name to every
 *  regex that names it. One pass, so the area picker and the resolver cannot
 *  drift into matching different text for the same name. */
const AREA_MATCHERS: Map<string, RegExp[]> = new Map();

const LOCALITY_MATCHERS: { key: ZoneKey; re: RegExp }[] = (() => {
  const out: { key: ZoneKey; re: RegExp }[] = [];
  /** @param area the CANONICAL name this spelling belongs to; equals `name`
   *  except for aliases, which fold onto the canonical entry. */
  const push = (key: ZoneKey, name: string, area: string) => {
    const re = new RegExp(
      `(?:^|[^a-z0-9])${escapeRegex(name.toLowerCase())}(?=[^a-z0-9]|$)`,
      "i",
    );
    out.push({ key, re });
    const areaKey = area.toLowerCase();
    const list = AREA_MATCHERS.get(areaKey);
    if (list) list.push(re);
    else AREA_MATCHERS.set(areaKey, [re]);
  };
  for (const def of ZONE_DEFS) {
    for (const name of def.localities) push(def.key, name, name);
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
    push(owner.key, alias, canonical);
  }
  return out;
})();

/**
 * Does this address text name this area?
 *
 * The area picker on the partner deliveries board needs to ask a question the
 * zone resolver does not answer: a row's ZONE can come from a pincode, a
 * learned rule or a row override, none of which name a locality. So area is a
 * separate, text-only test — and it lives here, next to the matchers, because
 * a second regex built at a call site is exactly how a picker starts showing
 * a different set from the one the resolver zoned.
 *
 * Matching an alias counts: a row written "Madhurawada" IS in Madhurwada, and
 * the picker only ever offers the canonical name (see `ZONE_AREAS`).
 *
 * An address that matches NOTHING is not an error — the row is still in its
 * zone, it simply has no area name. Callers must account for those rows
 * rather than let them fall off the board.
 */
export function addressMatchesArea(
  address: string | null | undefined,
  area: string,
): boolean {
  const text = (address ?? "").trim();
  if (!text) return false;
  const res = AREA_MATCHERS.get(area.trim().toLowerCase());
  if (!res) return false;
  return res.some((re) => re.test(text));
}

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

// ---------------------------------------------------------------------------
// Learned rules — DB-backed overrides.
//
// The rules table is the map Sunny edits from the board. The resolver reads
// it at priority 3 (pincode) and 4 (locality), OVERRIDING the built-in maps
// at 5 and 6. Row-overrides (a pin on a specific order/subscription row) sit
// at priority 2, above every rule and every built-in.
//
// This module never queries the database — the caller fetches the ruleset
// once per render and hands it in. That keeps the resolver a pure function
// callable from the share message, print sheet and bake strip without
// threading a Supabase client through every one of them.
// ---------------------------------------------------------------------------

export type NumberedZone = Exclude<ZoneKey, "unzoned" | "pickup">;

export type ZoneRuleSet = {
  /** normalised pincode -> zone */
  pincode: Map<string, NumberedZone>;
  /** normalised locality token -> zone */
  locality: Map<string, NumberedZone>;
  /** order id -> zone */
  rowByOrder: Map<string, NumberedZone>;
  /** subscription id -> zone */
  rowBySubscription: Map<string, NumberedZone>;
};

export const EMPTY_RULE_SET: ZoneRuleSet = {
  pincode: new Map(),
  locality: new Map(),
  rowByOrder: new Map(),
  rowBySubscription: new Map(),
};

/** Provenance — which of the seven ladder steps produced the zone. Rendered
 *  in the ZoneBadge tooltip and used by the provenance dot: any `rule_*`
 *  or `row_override` source gets the dot, everything else is plain. */
export type ZoneSource =
  | "pickup"
  | "row_override"
  | "rule_pincode"
  | "rule_locality"
  | "builtin_pincode"
  | "builtin_locality"
  | "unzoned";

export type ZoneResolution = {
  zone: ZoneKey;
  source: ZoneSource;
  /** The key that matched, when a rule or built-in map hit. Populated for
   *  `rule_pincode` / `rule_locality` / `builtin_pincode` / `builtin_locality`
   *  and undefined for `pickup` / `row_override` / `unzoned`. Used by the
   *  popover to decide which key to write when the operator picks a zone. */
  matchedKey?: { type: "pincode" | "locality"; value: string };
};

// ---- normalisers ---------------------------------------------------------
// Same functions the writer uses to produce key_value and the reader uses to
// look up. Never call them from anywhere else — the shared implementation is
// the whole point.

/** Digits-only, exactly six. Anything else → empty string (no match). */
export function normalisePincodeKey(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D+/g, "");
  return /^\d{6}$/.test(digits) ? digits : "";
}

/** Lowercase, trim, collapse internal whitespace, drop punctuation that
 *  would break the whole-word match ("M.V.P." and "MVP" must normalise the
 *  same, so periods go). Aliases are applied FIRST so the stored key sits
 *  on the canonical spelling — a rule on "Kommadi" and a rule on "Kommadhi"
 *  otherwise collide when checkout autocomplete drifts. */
export function normaliseLocalityKey(raw: string | null | undefined): string {
  const base = (raw ?? "")
    .toLowerCase()
    .replace(/[.\-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return "";
  const alias = LOCALITY_ALIASES[base];
  const canonical = (alias ?? base).toLowerCase();
  return canonical.replace(/\s+/g, " ").trim();
}

// ---- resolver with rules -------------------------------------------------

export type ZoneInputsWithParent = ZoneInputs & {
  isPickup?: boolean;
  /** Parent id for row-override lookup. Exactly one of these must be set
   *  for a row-override to be honoured — a rule that pins an order id will
   *  not match a subscription and vice versa. */
  orderId?: string | null;
  subscriptionId?: string | null;
};

/**
 * Full seven-step resolver. Prefer this over {@link resolveZone} on any
 * surface that shows a badge or reads rules — the board, the print sheet,
 * the share composer, the rules panel preview. Callers that only need the
 * string-driven built-in map (bake strip fallback in unit tests, offline
 * scripts) can still call {@link resolveZone}.
 */
export function resolveZoneWithSource(
  inputs: ZoneInputsWithParent,
  rules: ZoneRuleSet = EMPTY_RULE_SET,
): ZoneResolution {
  // 1. Pickup — either explicit or textual.
  if (inputs.isPickup) return { zone: "pickup", source: "pickup" };
  const address = (inputs.address ?? "").trim();
  if (address && PICKUP_HINTS.test(address)) {
    return { zone: "pickup", source: "pickup" };
  }

  // 2. Row override.
  if (inputs.orderId) {
    const z = rules.rowByOrder.get(inputs.orderId);
    if (z) return { zone: z, source: "row_override" };
  }
  if (inputs.subscriptionId) {
    const z = rules.rowBySubscription.get(inputs.subscriptionId);
    if (z) return { zone: z, source: "row_override" };
  }

  // Candidate pincodes: explicit column first, then any 6-digit runs in
  // the address text (multiple, source order — see extractPincodes).
  const explicitPin = normalisePincodeKey(inputs.pincode);
  const addressPins = extractPincodes(address);
  const pinCandidates = explicitPin
    ? [explicitPin, ...addressPins.filter((p) => p !== explicitPin)]
    : addressPins;

  // 3. Rule by pincode.
  for (const pin of pinCandidates) {
    const z = rules.pincode.get(pin);
    if (z) {
      return {
        zone: z,
        source: "rule_pincode",
        matchedKey: { type: "pincode", value: pin },
      };
    }
  }

  // 4. Rule by locality. Iterate the RULES and test each rule's name against
  // the address — NOT the other way round.
  //
  // This used to iterate LOCALITY_TOKENS (the built-in names) and ask whether
  // a rule existed for each hit. That made a rule for any name NOT already in
  // ZONE_DEFS unreachable: the loop never produced its key, so the map was
  // never queried with it. The row inserted fine, the panel listed it, and it
  // matched nothing, forever. Driving the loop from the rules is what lets an
  // operator name an area the built-in map has never heard of.
  //
  // Order is by key length descending (ties alphabetical) so the MOST
  // SPECIFIC name wins: a rule on "madhurawada" must beat a rule on "madhur"
  // on an address containing both. Map insertion order would make the answer
  // depend on the order the rows came back from Postgres.
  if (address && rules.locality.size > 0) {
    // Array.from, not [...]: this file compiles under the repo's ES5-ish
    // target, where spreading a Map iterator needs downlevelIteration.
    for (const key of Array.from(rules.locality.keys()).sort(
      (a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0),
    )) {
      if (localityKeyMatches(key, address)) {
        return {
          zone: rules.locality.get(key)!,
          source: "rule_locality",
          matchedKey: { type: "locality", value: key },
        };
      }
    }
  }

  // 5. Built-in pincode map.
  for (const pin of pinCandidates) {
    const z = PINCODE_TO_ZONE[pin];
    if (z && z !== "unzoned" && z !== "pickup") {
      return {
        zone: z,
        source: "builtin_pincode",
        matchedKey: { type: "pincode", value: pin },
      };
    }
  }

  // 6. Built-in locality list.
  if (address) {
    for (const { key, re } of LOCALITY_MATCHERS) {
      if (re.test(address)) {
        return {
          zone: key,
          source: "builtin_locality",
          matchedKey: { type: "locality", value: normaliseLocalityKey(re.source) },
        };
      }
    }
  }

  // 7. Unzoned.
  return { zone: "unzoned", source: "unzoned" };
}

// A parallel list of matchers whose `.name` we can hand back to a rule key.
// The existing LOCALITY_MATCHERS discards the source name inside the regex,
// so the resolver would have no way to compute normaliseLocalityKey() on a
// match. This list keeps the canonical name alongside the regex.
type LocalityToken = {
  key: NumberedZone;
  name: { canonical: string; re: RegExp };
};
const LOCALITY_TOKENS: LocalityToken[] = (() => {
  const out: LocalityToken[] = [];
  for (const def of ZONE_DEFS) {
    for (const name of def.localities) {
      out.push({
        key: def.key,
        name: {
          canonical: name,
          re: new RegExp(
            `(?:^|[^a-z0-9])${escapeRegex(name.toLowerCase())}(?=[^a-z0-9]|$)`,
            "i",
          ),
        },
      });
    }
  }
  for (const [alias, canonical] of Object.entries(LOCALITY_ALIASES)) {
    const owner = ZONE_DEFS.find((d) =>
      d.localities.some((l) => l.toLowerCase() === canonical.toLowerCase()),
    );
    if (!owner) continue; // already validated in LOCALITY_MATCHERS builder
    out.push({
      key: owner.key,
      name: {
        canonical,
        re: new RegExp(
          `(?:^|[^a-z0-9])${escapeRegex(alias.toLowerCase())}(?=[^a-z0-9]|$)`,
          "i",
        ),
      },
    });
  }
  return out;
})();

// ---- locality-rule matching ----------------------------------------------

/** Every BUILT-IN spelling that normalises to a given key, as a matcher.
 *
 *  A rule is stored on the NORMALISED key ("madhurwada"), but the addresses
 *  it has always matched include the alias spellings ("Madhurawada"). Step 4
 *  used to get that for free by testing the built-in regexes first. Now that
 *  it drives off the rules, it has to look those spellings up — otherwise
 *  re-pointing an existing locality would quietly stop matching half the
 *  addresses it matched yesterday.
 *
 *  Keys with no built-in spellings (the whole point of "Add to List") simply
 *  aren't in here, and fall through to the generic matcher below. */
const SPELLINGS_BY_KEY: Map<string, RegExp[]> = (() => {
  const out = new Map<string, RegExp[]>();
  const add = (spelling: string) => {
    // normaliseLocalityKey folds aliases, so an alias and its canonical both
    // land on the same key — which is exactly what we want.
    const key = normaliseLocalityKey(spelling);
    if (!key) return;
    const re = new RegExp(
      `(?:^|[^a-z0-9])${escapeRegex(spelling.toLowerCase())}(?=[^a-z0-9]|$)`,
      "i",
    );
    const list = out.get(key);
    if (list) list.push(re);
    else out.set(key, [re]);
  };
  for (const def of ZONE_DEFS) for (const name of def.localities) add(name);
  for (const alias of Object.keys(LOCALITY_ALIASES)) add(alias);
  return out;
})();

/** Matcher for a normalised key that has no built-in spelling.
 *
 *  The key has had its punctuation flattened to single spaces, so matching it
 *  literally would fail on the very text it came from: the key "p m palem"
 *  must still match "P.M.palem". Each space therefore becomes a run of
 *  non-alphanumerics, and the whole thing keeps the boundary semantics used
 *  everywhere else in this file — any non-alphanumeric (or string edge) on
 *  either side, NOT \b, which would not survive the periods and spaces. */
const GENERIC_MATCHER_CACHE = new Map<string, RegExp>();

function genericLocalityMatcher(key: string): RegExp {
  const hit = GENERIC_MATCHER_CACHE.get(key);
  if (hit) return hit;
  const body = key.split(" ").map(escapeRegex).join("[^a-z0-9]+");
  const re = new RegExp(`(?:^|[^a-z0-9])${body}(?=[^a-z0-9]|$)`, "i");
  GENERIC_MATCHER_CACHE.set(key, re);
  return re;
}

/** Does this address name the locality this rule is stored under? */
function localityKeyMatches(key: string, address: string): boolean {
  const builtIn = SPELLINGS_BY_KEY.get(key);
  if (builtIn?.some((re) => re.test(address))) return true;
  return genericLocalityMatcher(key).test(address);
}

/** Would a locality rule named `raw` match this address?
 *
 *  Exported so a UI can preview a rule BEFORE writing it using the exact
 *  predicate step 4 will use. Do not count matches with a substring test:
 *  `includes("nagar")` also hits "Nagarampalem", so the preview would claim
 *  more stops than the rule takes — the one number the operator is relying on
 *  to spot an over-broad name would be the number that is wrong. */
export function localityNameMatchesAddress(
  raw: string | null | undefined,
  address: string | null | undefined,
): boolean {
  const key = normaliseLocalityKey(raw);
  if (!key || !address) return false;
  return localityKeyMatches(key, address);
}

// ---- rule-key chooser ----------------------------------------------------

/** Given an address, decide what (key_type, key_value, key_input) a rule
 *  would be written on if the operator picks a zone right now.
 *
 *  Preference order matches the resolver's read order: pincode first
 *  (deterministic, cheap, unambiguous), then locality (the first token the
 *  built-in matchers would have matched), then null when the address has
 *  neither — that null is the signal to switch the UI into row-override
 *  mode. */
export function pickRuleKey(inputs: {
  address?: string | null;
  pincode?: string | null;
}): { key_type: "pincode" | "locality"; key_value: string; key_input: string } | null {
  const address = (inputs.address ?? "").trim();
  const explicit = normalisePincodeKey(inputs.pincode);
  if (explicit) {
    return {
      key_type: "pincode",
      key_value: explicit,
      key_input: (inputs.pincode ?? "").trim() || explicit,
    };
  }
  for (const pin of extractPincodes(address)) {
    return { key_type: "pincode", key_value: pin, key_input: pin };
  }
  if (address) {
    for (const { name } of LOCALITY_TOKENS) {
      const m = address.match(name.re);
      if (m) {
        const raw = name.canonical;
        return {
          key_type: "locality",
          key_value: normaliseLocalityKey(raw),
          key_input: raw,
        };
      }
    }
  }
  return null;
}
