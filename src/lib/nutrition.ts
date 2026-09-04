// Per-slice nutrition: units, lower-bound values, and the save guard.
//
// Pure — no Supabase, no next/cache — so the SAME rules run in three places:
// the PDP renderer, the admin form (client-side, before submit), and the
// admin PATCH route. A guard that only lives in the API lets an admin type a
// wrong figure, wait for a round trip, and lose their place in the form.
//
// Why this file exists at all: the units used to be inferred from the key's
// suffix (`_g` → "g", everything else → NO unit), so a bare `sodium` key
// rendered "22.5" with nothing after it — an unlabelled decimal slip of 225 mg
// that nobody could spot on the page. Units are now an explicit map.

import { formatNutrientValue, parseWeightGrams } from "./stat-tiles";

// A stored nutrition_per_slice value. Numbers are exact lab figures; strings
// are lower bounds ("<0.04") for results a lab reports as "less than", where
// storing 0.04 would be a false precision claim.
export type NutrientValue = number | string;

// A plain figure ("6.86") or a bound ("<0.04", "< 0.36"). Leading "<" only —
// a bound is always an upper limit. Both string forms are accepted because
// the admin form holds every value as text: a numeric input can't be left
// blank cleanly and outright rejects the "<" of a bound.
const NUTRIENT_RE = /^(<\s*)?(\d+(?:\.\d+)?)$/;

// The pattern the Zod schema validates a string-shaped value against.
export const NUTRIENT_INPUT_PATTERN = NUTRIENT_RE.source;

export type ParsedNutrient = { amount: number; isBound: boolean };

// Parse a stored (or freshly typed) value into a number plus a bound flag.
// Returns null for anything unusable, which is what the renderer's filter and
// the PATCH normaliser both key off — an unparseable value is DROPPED rather
// than rendered as a phantom zero.
export function parseNutrientValue(v: unknown): ParsedNutrient | null {
  if (typeof v === "number") {
    return Number.isFinite(v) && v >= 0 ? { amount: v, isBound: false } : null;
  }
  if (typeof v === "string") {
    const match = NUTRIENT_RE.exec(v.trim());
    if (!match) return null;
    const amount = Number(match[2]);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return { amount, isBound: Boolean(match[1]) };
  }
  return null;
}

// Normalise a parsed value back to its canonical stored form, so "< 0.04"
// and "<0.04" don't both end up in the jsonb.
export function canonicalNutrientValue(parsed: ParsedNutrient): NutrientValue {
  return parsed.isBound ? `<${trimNumber(parsed.amount)}` : parsed.amount;
}

// ── units + labels ──────────────────────────────────────────────────────────

// EXPLICIT unit per canonical key. Never inferred: sodium and cholesterol are
// milligrams, and the whole point of this map is that mg can never be read as
// g (or as nothing at all) by accident.
export const NUTRIENT_UNITS: Record<string, string> = {
  protein_g: "g",
  carbs_g: "g",
  fat_g: "g",
  fibre_g: "g",
  sugar_g: "g",
  saturated_fat_g: "g",
  trans_fat_g: "g",
  added_sugar_g: "g",
  sodium_mg: "mg",
  cholesterol_mg: "mg",
  calories: "kcal",
};

// Food-label wording, so the page reads "Saturated fat" not "Saturated Fat".
const NUTRIENT_LABELS: Record<string, string> = {
  protein_g: "Protein",
  carbs_g: "Carbs",
  fat_g: "Fat",
  fibre_g: "Fibre",
  sugar_g: "Sugar",
  saturated_fat_g: "Saturated fat",
  trans_fat_g: "Trans fat",
  added_sugar_g: "Added sugar",
  sodium_mg: "Sodium",
  cholesterol_mg: "Cholesterol",
  calories: "Calories",
};

// Canonical key order — also the row order in the admin form and on the PDP.
export const CANONICAL_NUTRIENT_KEYS = [
  "protein_g",
  "carbs_g",
  "fat_g",
  "fibre_g",
  "sugar_g",
  "saturated_fat_g",
  "trans_fat_g",
  "added_sugar_g",
  "sodium_mg",
  "cholesterol_mg",
  "calories",
] as const;

export function isCanonicalNutrientKey(key: string): boolean {
  return (CANONICAL_NUTRIENT_KEYS as readonly string[]).includes(key);
}

// Unit for a key: the explicit map first, then a suffix fallback so a future
// custom `potassium_mg` still renders its unit instead of a bare number.
export function nutrientUnit(key: string): string {
  const mapped = NUTRIENT_UNITS[key];
  if (mapped !== undefined) return mapped;
  if (key.endsWith("_mg")) return "mg";
  if (key.endsWith("_g")) return "g";
  if (key.endsWith("_kcal")) return "kcal";
  return "";
}

export function nutrientLabel(key: string): string {
  const mapped = NUTRIENT_LABELS[key];
  if (mapped !== undefined) return mapped;
  const stripped = key.replace(/_(mg|g|kcal)$/, "");
  const label = stripped
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part, i) =>
      i === 0
        ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
        : part.toLowerCase(),
    )
    .join(" ");
  return label || key;
}

// STORAGE form, not display form: up to two decimals with trailing zeros
// trimmed, used to canonicalise a bound back into the jsonb. Display rounding
// is formatNutrientValue's job and must not be applied here — the stored
// value keeps the precision the lab reported.
function trimNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(2)));
}

// The full right-hand cell for the PDP table: "6.9 g", "225 mg",
// "< 0.04 g", "102 kcal". Returns null when the value is unusable.
export function formatNutrient(key: string, value: unknown): string | null {
  const parsed = parseNutrientValue(value);
  if (!parsed) return null;
  const unit = nutrientUnit(key);
  const num = formatNutrientValue(parsed.amount, unit, parsed.isBound);
  const prefix = parsed.isBound ? "< " : "";
  return unit ? `${prefix}${num} ${unit}` : `${prefix}${num}`;
}

// ── the save guard ──────────────────────────────────────────────────────────

// A slice cannot contain more of these four than it weighs. This is the check
// that catches a decimal slip: fibre 20.7 instead of 2.07 pushes the sum past
// the slice weight and the save is rejected.
const MACRO_SUM_KEYS = ["protein_g", "carbs_g", "fibre_g", "fat_g"] as const;

// Atwater factors, with 2 kcal/g for fibre (partially fermented).
const CALORIE_FACTORS: Record<string, number> = {
  protein_g: 4,
  carbs_g: 4,
  fat_g: 9,
  fibre_g: 2,
};

export const CALORIE_TOLERANCE_PCT = 20;

// Float slack so 35.714285… doesn't reject a sum of exactly 35.71.
const SUM_EPSILON = 0.01;

export type NutritionSource = {
  weight: string | null;
  slices_per_loaf: number | null;
};

// grams in one slice = products.weight ÷ products.slices_per_loaf. NEVER a
// constant: a future 400 g loaf must recompute on its own. Returns null when
// either field is missing or unparseable — the guard then skips the sum check
// rather than inventing a limit.
export function sliceWeightGrams(source: NutritionSource): number | null {
  const loaf = parseWeightGrams(source.weight);
  const slices = source.slices_per_loaf;
  if (loaf === null) return null;
  if (typeof slices !== "number" || !Number.isFinite(slices) || slices <= 0) {
    return null;
  }
  return loaf / slices;
}

// `keys` are the fields the message should appear next to in the admin form.
export type NutritionIssue = { keys: string[]; message: string };

// Reject impossible nutrition. Bounds contribute their numeric part to the
// sum — a bound is an upper limit, so using it is the conservative reading.
export function validateNutritionPerSlice(
  nutrition: Record<string, unknown> | null | undefined,
  source: NutritionSource,
): NutritionIssue[] {
  if (!nutrition) return [];
  const issues: NutritionIssue[] = [];

  const amount = (key: string): number | null => {
    const parsed = parseNutrientValue(nutrition[key]);
    return parsed ? parsed.amount : null;
  };

  // 1. macro sum vs slice weight
  const present = MACRO_SUM_KEYS.filter((k) => amount(k) !== null);
  const sliceGrams = sliceWeightGrams(source);
  if (present.length > 0 && sliceGrams !== null) {
    const sum = present.reduce((acc, k) => acc + (amount(k) ?? 0), 0);
    if (sum > sliceGrams + SUM_EPSILON) {
      issues.push({
        keys: [...present],
        message:
          `Protein + carbs + fibre + fat comes to ${round2(sum)} g, but one ` +
          `slice weighs only ${round2(sliceGrams)} g ` +
          `(${source.weight} ÷ ${source.slices_per_loaf} slices). ` +
          `Check for a misplaced decimal point.`,
      });
    }
  }

  // 2. stated calories vs the macros they should follow from
  const stated = amount("calories");
  if (stated !== null) {
    const computed = Object.entries(CALORIE_FACTORS).reduce(
      (acc, [key, factor]) => acc + (amount(key) ?? 0) * factor,
      0,
    );
    if (computed > 0) {
      const driftPct = (Math.abs(stated - computed) / computed) * 100;
      if (driftPct > CALORIE_TOLERANCE_PCT) {
        issues.push({
          keys: ["calories"],
          message:
            `${round2(stated)} kcal is ${Math.round(driftPct)}% away from the ` +
            `${round2(computed)} kcal the macros give ` +
            `(4×protein + 4×carbs + 9×fat + 2×fibre). ` +
            `Tolerance is ${CALORIE_TOLERANCE_PCT}%.`,
        });
      }
    }
  }

  return issues;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}
