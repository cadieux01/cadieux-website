// Shared vocabulary for the raw-materials + vendors admin screens.
//
// NO SERVER IMPORTS IN THIS FILE. Both the API routes and the two
// "use client" pages import it. Pulling in @/lib/admin-auth — or anything
// that transitively reaches SUPABASE_SERVICE_ROLE_KEY — would blank the page
// with no failing request and nothing in the log, the exact failure
// documented at the top of admin-auth.ts. Keep this file pure data and pure
// functions so either side can import it safely.

/**
 * The unit vocabulary, READ FROM THE DATABASE rather than retyped.
 *
 * Source: CHECK constraint `raw_materials_unit_check` on prod
 * (project uejagupcwevadfhfuadv), read 2026-11-02. Verbatim:
 *
 *   CHECK ((unit = ANY (ARRAY['kg'::text, 'g'::text, 'l'::text,
 *                             'ml'::text, 'pcs'::text, 'packet'::text])))
 *
 * `production_batch_materials_unit_check` carries the IDENTICAL six values,
 * which is what makes the composite FK between the two tables workable.
 *
 * WHY A CONSTANT AND NOT A LIVE QUERY: PostgREST exposes only the public
 * schema's tables, so `pg_constraint` is simply not reachable through
 * supabase-js. Reading the CHECK at request time would need a new SQL
 * function — a migration, which is out of scope here and on this project is
 * applied by hand. The database stays the enforcer regardless: this list only
 * decides what the <select> offers, and lets the API refuse an unknown unit
 * with a sentence instead of a raw Postgres error. If the CHECK ever gains a
 * unit, this array is the single place to change.
 */
export const RAW_MATERIAL_UNITS = [
  "kg",
  "g",
  "l",
  "ml",
  "pcs",
  "packet",
] as const;

export type RawMaterialUnit = (typeof RAW_MATERIAL_UNITS)[number];

export function isRawMaterialUnit(v: unknown): v is RawMaterialUnit {
  return (
    typeof v === "string" &&
    (RAW_MATERIAL_UNITS as readonly string[]).includes(v)
  );
}

/**
 * Length ceilings, also read from the live CHECK constraints so the form can
 * stop a value the database would reject. Each one mirrors a
 * `length(btrim(col)) <= N` check on prod.
 */
export const FIELD_LIMITS = {
  code: 40, // raw_materials_code_check
  name: 160, // raw_materials_name_check / vendors_name_check
  category: 60, // raw_materials_category_check
  contactPerson: 120, // vendors_contact_person_check
  phone: 20, // vendors_phone_check
  whatsapp: 20, // vendors_whatsapp_check
} as const;

// ── input normalisation ────────────────────────────────────────────────────

/**
 * Result of normalising one optional text field. A discriminated union rather
 * than a bare string so "the operator cleared this" (null) stays distinct
 * from "this is too long for the column" — two outcomes that need different
 * responses and that a `string | null` return would merge.
 */
export type TextResult =
  | { ok: true; value: string | null }
  | { ok: false; reason: "too_long" };

/**
 * Trim an optional text field and enforce the column's own length ceiling.
 *
 * Empty string becomes null, so the database records "not provided" rather
 * than "provided as nothing" — the same choice normalizePincode makes in
 * /api/admin/locations, and the reason `phone IS NULL` stays a usable query.
 */
export function optionalText(v: unknown, max: number): TextResult {
  if (typeof v !== "string") return { ok: true, value: null };
  const t = v.trim();
  if (t === "") return { ok: true, value: null };
  if (t.length > max) return { ok: false, reason: "too_long" };
  return { ok: true, value: t };
}

/**
 * Same, for the columns that carry NO length CHECK in the database:
 * vendors.address, vendors.notes, raw_materials.notes. They are plain
 * unconstrained text, so inventing a ceiling here would reject input the
 * database would happily accept — a limit the operator could not discover
 * from any error message.
 */
export function freeText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export type NumberResult =
  | { ok: true; value: number | null }
  | { ok: false };

/**
 * `reorder_level` (numeric, CHECK >= 0) and `lead_time_days` (integer,
 * CHECK >= 0) are both nullable, and BLANK MUST MEAN NULL — never 0.
 *
 * Writing 0 for an empty box would assert "reorder when stock hits zero",
 * which is a decision nobody made, and it would move the material out of the
 * UNDECIDED state the board deliberately shows separately. So an empty
 * string, null and undefined all return null, and only a genuinely
 * unparseable or negative value is rejected.
 */
export function optionalNonNegativeNumber(
  v: unknown,
  opts: { integer?: boolean } = {},
): NumberResult {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  if (opts.integer && !Number.isInteger(n)) return { ok: false };
  return { ok: true, value: n };
}

/**
 * Why the unit field locks. ONE owner for this sentence: the API returns it
 * as the 400 body and the form shows it as the disabled-field hint, so the
 * operator reads identical words whichever path they hit.
 */
export const UNIT_LOCKED_REASON =
  "This material has already been used in a production batch, so its unit can no longer change. Create a separate material if you need a different unit.";

/** Soft-delete wording, shared by both screens for the same reason. */
export const DEACTIVATE_NOTE =
  "Deactivating hides this from new entry but keeps every past record intact. Nothing here is ever deleted.";

// ── reorder state ──────────────────────────────────────────────────────────

export type ReorderState = "below" | "ok" | "undecided";

/**
 * Translate the view's `needs_reorder` into the three states the UI renders.
 *
 * THREE, not two. `raw_material_stock.needs_reorder` is a genuinely
 * three-valued column:
 *
 *   CASE WHEN m.reorder_level IS NULL THEN NULL
 *        ELSE <stock> <= m.reorder_level END
 *
 * so NULL means "nobody has decided a reorder level for this material yet",
 * which is a different fact from "there is enough". Collapsing NULL into `ok`
 * would quietly report every un-configured material as healthy — the failure
 * this screen exists to avoid.
 *
 * `undefined` maps to "undecided" too, deliberately. A JSON body that omits
 * the key is indistinguishable here from one that sent null, and routes in
 * this codebase do drop nulls via conditional spread. The safe direction is
 * the one that cannot read as reassurance.
 *
 * The comparison itself is NOT repeated here. Stock is computed once, in the
 * view, from stock_movements; this function only reads the answer.
 */
export function reorderState(
  needsReorder: boolean | null | undefined,
): ReorderState {
  if (needsReorder === null || needsReorder === undefined) return "undecided";
  return needsReorder ? "below" : "ok";
}

export const REORDER_LABEL: Record<ReorderState, string> = {
  below: "Below level",
  ok: "In stock",
  undecided: "No level set",
};

// ── row shapes ─────────────────────────────────────────────────────────────

/**
 * Postgres `numeric` arrives from supabase-js as a string often enough that
 * typing it as `number` is a lie that only shows up at runtime. Both columns
 * are read-only here, so the union costs nothing.
 */
export type Numericish = number | string | null;

/** One row of the raw_material_stock VIEW, exactly as it is defined. */
export type RawMaterialStockRow = {
  material_id: string;
  code: string;
  name: string;
  unit: RawMaterialUnit;
  category: string | null;
  reorder_level: Numericish;
  lead_time_days: number | null;
  vendor_id: string | null;
  is_active: boolean;
  current_qty: Numericish;
  movement_count: number;
  last_movement_at: string | null;
  needs_reorder: boolean | null;
};

/**
 * What GET /api/admin/raw-materials returns: the view's row plus the three
 * things the view does not carry.
 *
 * `notes` is absent from raw_material_stock, so it is read from the base
 * table and merged. `unit_locked` is the answer to "do production_batch_materials
 * rows exist for this material" — the UI needs it to disable the field BEFORE
 * a save fails, and it cannot be derived from the view.
 */
export type RawMaterialAdminRow = RawMaterialStockRow & {
  notes: string | null;
  vendor_name: string | null;
  unit_locked: boolean;
};

export type VendorRow = {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * Display helper for the two numeric columns. Formatting only — it never
 * decides anything, and it keeps `0` distinct from "no value", which matters
 * because a material at exactly zero stock is a real and urgent state.
 */
export function formatQty(v: Numericish): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  // The view returns numeric(14,3); trim trailing zeros but keep integers bare.
  return String(Number(n.toFixed(3)));
}
