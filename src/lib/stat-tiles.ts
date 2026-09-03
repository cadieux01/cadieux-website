// PDP / shop stat-strip resolution. Pure — no Supabase, no next/cache — so it
// can be imported by the admin client bundle as well as server components.
//
// product_stat_tiles is an admin free-text table, which let the net weight and
// slice count drift away from products.weight / products.slices_per_loaf — the
// same row that feeds the nutrition table and the Product JSON-LD. Those two
// keys are now DERIVED: the stored tile value is ignored entirely and read
// through to the products row instead, so drift is structurally impossible.
// Every other tile key stays exactly as the admin typed it.
//
// The per-slice protein and fibre tiles are derived for the same reason: they
// restate figures that already live in products.nutrition_per_slice, the row
// that feeds the nutrition table. Hand-editing either side could make the stat
// strip and the table print different numbers for the same food label.

export type StatTileLike = {
  id: string;
  tile_key: string;
  value: string;
  label: string;
  sort_order: number;
};

// The subset of a products row the derived tiles read from.
export type StatTileSource = {
  weight: string | null;
  slices_per_loaf: number | null;
  nutrition_per_slice: Record<string, number> | null;
};

// Reads one figure out of the nutrition jsonb. Returns null unless the key
// holds a finite, non-negative number, so a missing or malformed entry drops
// the tile rather than printing a stale or nonsense figure. Zero is a valid
// food-label value and is preserved.
function nutritionFigure(
  p: StatTileSource,
  jsonKey: string,
): string | null {
  const raw = p.nutrition_per_slice?.[jsonKey];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
  return String(raw);
}

const DERIVED_TILE_SOURCES: Record<
  string,
  { read: (p: StatTileSource) => string | null; note: string }
> = {
  net_weight: {
    read: (p) => (p.weight ?? "").trim() || null,
    note: "Read from the product's Weight field above — edit it there.",
  },
  slices: {
    read: (p) =>
      typeof p.slices_per_loaf === "number" && p.slices_per_loaf > 0
        ? String(p.slices_per_loaf)
        : null,
    note: "Read from the product's Slices per loaf field above — edit it there.",
  },
  // NOTE the deliberate spelling mismatch, mapped explicitly rather than
  // inferred from the tile key: the tile key is American (`fiber_per_slice`)
  // while the jsonb key is British (`fibre_g`). Deriving one from the other
  // by string munging would silently return undefined and drop the tile.
  protein_per_slice: {
    read: (p) => nutritionFigure(p, "protein_g"),
    note: "Read from Protein (g) in the product's per-slice nutrition fields above — edit it there.",
  },
  fiber_per_slice: {
    read: (p) => nutritionFigure(p, "fibre_g"),
    note: "Read from Fibre (g) in the product's per-slice nutrition fields above — edit it there.",
  },
};

export const DERIVED_TILE_KEYS = Object.keys(DERIVED_TILE_SOURCES);

// The value a derived tile will actually render, or null when the products row
// has nothing to derive from (the tile is then dropped entirely).
export function derivedTileValue(
  tileKey: string,
  product: StatTileSource,
): string | null {
  return DERIVED_TILE_SOURCES[tileKey]?.read(product) ?? null;
}

export function derivedTileNote(tileKey: string): string | null {
  return DERIVED_TILE_SOURCES[tileKey]?.note ?? null;
}

// Overlay derived values onto the admin tiles. A derived tile with no source
// value is DROPPED rather than rendered blank or with a stale number — a food
// label must never show a figure that isn't in the products table.
export function resolveStatTiles<T extends StatTileLike>(
  tiles: T[],
  product: StatTileSource | null | undefined,
): T[] {
  const out: T[] = [];
  for (const tile of tiles) {
    if (!(tile.tile_key in DERIVED_TILE_SOURCES)) {
      out.push(tile);
      continue;
    }
    const derived = product ? derivedTileValue(tile.tile_key, product) : null;
    if (derived === null) continue;
    out.push({ ...tile, value: derived });
  }
  return out;
}

// Parse products.weight ("250g", "1.2 kg") into grams for schema.org's
// QuantitativeValue. Returns null when the free-text weight isn't parseable —
// callers must OMIT the schema field rather than guess, since Google reads it
// as a food label.
export function parseWeightGrams(
  weight: string | null | undefined,
): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*(kg|g)?$/.exec(
    (weight ?? "").trim().toLowerCase(),
  );
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return match[2] === "kg" ? amount * 1000 : amount;
}
