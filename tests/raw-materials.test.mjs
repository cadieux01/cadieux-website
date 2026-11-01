// Covers src/lib/raw-materials.ts — the shared vocabulary behind
// /admin/raw-materials.
//
// The suite exists for one reason above all others: the unit list in that
// module is a TRANSCRIPTION of a live CHECK constraint on prod, and a
// transcription drifts silently. `RAW_MATERIAL_UNITS` and
// `UNIT_CHECK_DEFINITION` are asserted against each other below, so editing
// either one alone fails `npm test` instead of shipping a dropdown that
// offers a value the database will reject.

import assert from "node:assert/strict";
import { test } from "node:test";

import "./_alias-hook.mjs";

// Dynamic import, AFTER the hook is registered. A static import would be
// linked before the hook runs and die with ERR_MODULE_NOT_FOUND on the .ts
// extension.
const {
  classifyReorder,
  codeError,
  CODE_MAX_LENGTH,
  isRawMaterialUnit,
  normalizeMaterialCode,
  optionalText,
  parseOptionalNonNegative,
  RAW_MATERIAL_UNITS,
  REORDER_LABEL,
  UNIT_CHECK_DEFINITION,
} = await import("../src/lib/raw-materials.ts");

test("the unit list and the constraint it was transcribed from agree", () => {
  // Parse the units back OUT of the recorded CHECK definition and compare.
  // This is the lockstep guard: a unit added to the list without the
  // constraint (or vice versa) fails here.
  const quoted = [...UNIT_CHECK_DEFINITION.matchAll(/'([^']+)'::text/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(
    quoted,
    [...RAW_MATERIAL_UNITS],
    "RAW_MATERIAL_UNITS must match UNIT_CHECK_DEFINITION exactly, in order. " +
      "If prod's raw_materials_unit_check really changed, update BOTH and " +
      "re-read the constraint before doing so.",
  );
});

test("isRawMaterialUnit accepts only the constrained values", () => {
  for (const unit of RAW_MATERIAL_UNITS) {
    assert.equal(isRawMaterialUnit(unit), true, unit);
  }
  // Case matters: the constraint compares the literal text, so "KG" is a
  // rejection at the database, which means it must be a rejection here too.
  for (const bad of ["KG", "Kg", "kgs", "litre", "", " kg", null, undefined, 1, {}]) {
    assert.equal(isRawMaterialUnit(bad), false, String(bad));
  }
});

test("classifyReorder keeps undecided distinct from ok", () => {
  assert.equal(classifyReorder(true), "below");
  assert.equal(classifyReorder(false), "ok");
  // The view returns NULL when reorder_level IS NULL. That is an answer, not
  // a missing value — it must never collapse into "ok", which would claim
  // stock is sufficient when nothing was ever compared.
  assert.equal(classifyReorder(null), "undecided");
  assert.equal(classifyReorder(undefined), "undecided");
  assert.notEqual(REORDER_LABEL.undecided, REORDER_LABEL.ok);
});

test("normalizeMaterialCode trims the outer whitespace and nothing else", () => {
  // raw_materials_code_check requires code = btrim(code), so outer
  // whitespace has to go. Case does NOT: codes are read off supplier
  // paperwork and "MLK-01" is not "mlk-01" to the person holding the invoice.
  assert.equal(normalizeMaterialCode("  MLK-01  "), "MLK-01");
  assert.equal(normalizeMaterialCode("MLK-01"), "MLK-01");
  assert.equal(normalizeMaterialCode("mlk 01"), "mlk 01");
  assert.equal(normalizeMaterialCode(42), "");
  assert.equal(normalizeMaterialCode(undefined), "");
});

test("codeError enforces required and the 40-char ceiling", () => {
  assert.equal(codeError("MLK-01"), null);
  assert.equal(codeError("x".repeat(CODE_MAX_LENGTH)), null);
  assert.ok(codeError(""));
  assert.ok(codeError("x".repeat(CODE_MAX_LENGTH + 1)));
});

test("optionalText turns a cleared field into NULL, not an empty string", () => {
  // Every nullable text column carries length(btrim(col)) >= 1, so "" is a
  // constraint violation rather than a blank.
  assert.equal(optionalText(""), null);
  assert.equal(optionalText("   "), null);
  assert.equal(optionalText(null), null);
  assert.equal(optionalText(undefined), null);
  assert.equal(optionalText(" Dairy "), "Dairy");
});

test("parseOptionalNonNegative treats blank as NULL and keeps zero", () => {
  assert.deepEqual(parseOptionalNonNegative("", "Reorder level"), {
    ok: true,
    value: null,
  });
  assert.deepEqual(parseOptionalNonNegative(null, "Reorder level"), {
    ok: true,
    value: null,
  });
  // 0 is NOT the same as cleared. "reorder at zero" is a real, different
  // claim from "no threshold set", and the three-state reorder badge reads
  // the difference.
  assert.deepEqual(parseOptionalNonNegative(0, "Reorder level"), {
    ok: true,
    value: 0,
  });
  assert.deepEqual(parseOptionalNonNegative("2.5", "Reorder level"), {
    ok: true,
    value: 2.5,
  });
});

test("parseOptionalNonNegative rejects what the CHECK would reject", () => {
  assert.equal(parseOptionalNonNegative("-1", "Reorder level").ok, false);
  assert.equal(parseOptionalNonNegative("abc", "Reorder level").ok, false);
  // lead_time_days is an integer column, so a fractional day has to be
  // refused in the form rather than truncated on the way in.
  assert.equal(
    parseOptionalNonNegative("1.5", "Lead time", { integer: true }).ok,
    false,
  );
  assert.deepEqual(parseOptionalNonNegative("3", "Lead time", { integer: true }), {
    ok: true,
    value: 3,
  });
});
