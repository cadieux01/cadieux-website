// Shared vocabulary for /admin/raw-materials.
//
// NO server imports in this file. The admin page is "use client" and the
// tests import it directly, so pulling in @/lib/admin-auth here would ship
// SUPABASE_SERVICE_ROLE_KEY into a client bundle and blank the page — see the
// header of admin-auth.ts for the two times that happened.

// ── units ──────────────────────────────────────────────────────────────
// These six values are NOT a product decision made here; they are a
// transcription of a live CHECK constraint on prod (uejagupcwevadfhfuadv),
// read 2026-11-02:
//
//   constraint: raw_materials_unit_check
//   definition: CHECK ((unit = ANY (ARRAY['kg'::text, 'g'::text, 'l'::text,
//               'ml'::text, 'pcs'::text, 'packet'::text])))
//
// production_batch_materials carries the identical constraint
// (production_batch_materials_unit_check), so the two tables can never
// disagree about what a unit is.
//
// WHY A CONSTANT AND NOT A LIVE READ: a request-time read of the constraint
// would have to reach pg_constraint, which PostgREST does not expose, so it
// would need a new SQL function deployed to prod. That is a schema change and
// is out of scope for this screen. The DB stays the enforcement point either
// way — an insert or update carrying anything else is rejected by the
// constraint above, and the API surfaces that refusal verbatim. The constant
// only decides what the dropdown OFFERS.
//
// UNIT_CHECK_DEFINITION is kept beside the list so the pair can be asserted
// in lockstep by tests/raw-materials.test.mjs: editing one without the other
// fails `npm test`, which is what stops this list drifting from prod.
export const RAW_MATERIAL_UNITS = [
  "kg",
  "g",
  "l",
  "ml",
  "pcs",
  "packet",
] as const;

export type RawMaterialUnit = (typeof RAW_MATERIAL_UNITS)[number];

export const UNIT_CHECK_DEFINITION =
  "CHECK ((unit = ANY (ARRAY['kg'::text, 'g'::text, 'l'::text, 'ml'::text, 'pcs'::text, 'packet'::text])))";

export function isRawMaterialUnit(value: unknown): value is RawMaterialUnit {
  return (
    typeof value === "string" &&
    (RAW_MATERIAL_UNITS as readonly string[]).includes(value)
  );
}

// ── the unit lock ──────────────────────────────────────────────────────
// production_batch_materials has a COMPOSITE foreign key:
//
//   FOREIGN KEY (material_id, unit) REFERENCES raw_materials(id, unit)
//     ON UPDATE RESTRICT ON DELETE RESTRICT
//
// So once a single batch has consumed a material, Postgres refuses to change
// that material's unit — the referencing row would be orphaned. That refusal
// is correct and we do not re-implement it; we only make sure the operator
// meets it as a disabled field with a sentence, instead of as a 500 carrying
// a raw Postgres message after they have already typed a form.
export const UNIT_LOCKED_REASON =
  "Unit is fixed once a production batch has consumed this material — changing it would orphan those batch records. Create a new material instead.";

// ── reorder state ──────────────────────────────────────────────────────
// raw_material_stock.needs_reorder is a THREE-state column, because the
// view returns NULL when reorder_level IS NULL:
//
//   CASE WHEN m.reorder_level IS NULL THEN NULL::boolean
//        ELSE <summed qty> <= m.reorder_level END
//
// "undecided" is therefore not a missing value to be defaulted — it is the
// honest answer for a material nobody has set a threshold for. Rendering it
// as "ok" would claim stock is sufficient when nothing has been compared,
// so the three states stay distinct all the way to the screen.
export type ReorderState = "below" | "ok" | "undecided";

export function classifyReorder(needsReorder: boolean | null | undefined): ReorderState {
  if (needsReorder === null || needsReorder === undefined) return "undecided";
  return needsReorder ? "below" : "ok";
}

export const REORDER_LABEL: Record<ReorderState, string> = {
  // `<=` in the view, so hitting the threshold exactly already counts.
  below: "At / below reorder level",
  ok: "In stock",
  undecided: "No reorder level set",
};

// ── optional numbers ───────────────────────────────────────────────────
// reorder_level (numeric) and lead_time_days (integer) are both nullable
// with a `>= 0` CHECK. NULL is meaningful for reorder_level in particular:
// it is what drives the "undecided" reorder state above, so a cleared field
// must stay NULL rather than becoming 0 — 0 would assert "reorder at zero",
// which is a real and different claim.
export type NumberParse =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

export function parseOptionalNonNegative(
  raw: unknown,
  label: string,
  opts: { integer?: boolean } = {},
): NumberParse {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: null };
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number` };
  if (n < 0) return { ok: false, error: `${label} cannot be negative` };
  if (opts.integer && !Number.isInteger(n)) {
    return { ok: false, error: `${label} must be a whole number of days` };
  }
  return { ok: true, value: n };
}

// ── code ───────────────────────────────────────────────────────────────
// raw_materials_code_check is
//   CHECK (length(btrim(code)) BETWEEN 1 AND 40 AND code = btrim(code))
// The `code = btrim(code)` half means the stored value may not carry outer
// whitespace, so we strip that much. Everything else — case especially — is
// stored exactly as the operator typed it: codes get read off supplier
// paperwork and "MLK-01" is not "mlk-01" to the person holding the invoice.
export const CODE_MAX_LENGTH = 40;

export function normalizeMaterialCode(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

// ── optional text columns ──────────────────────────────────────────────
// Every nullable text column on both tables carries a
// `length(btrim(col)) >= 1` CHECK, so an empty string is NOT a valid
// "blank" — it is a constraint violation. A cleared field has to arrive as
// NULL. Used by all four route handlers.
export function optionalText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

export function codeError(code: string): string | null {
  if (!code) return "Code is required";
  if (code.length > CODE_MAX_LENGTH) {
    return `Code must be ${CODE_MAX_LENGTH} characters or fewer`;
  }
  return null;
}
