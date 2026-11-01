// The raw-materials / vendors admin vocabulary.
//
// What these assertions are actually protecting: three facts that live in the
// DATABASE and that the UI only translates. If one of them drifts here, the
// screen starts offering an edit Postgres will refuse, or reporting a material
// as healthy when nobody has decided what healthy means for it.
//
// Loaded through the alias hook with a top-level dynamic import, same reason
// as every other suite here — a static import resolves the graph before the
// hook installs.
import "./_alias-hook.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const {
  RAW_MATERIAL_UNITS,
  isRawMaterialUnit,
  FIELD_LIMITS,
  optionalText,
  freeText,
  optionalNonNegativeNumber,
  reorderState,
  REORDER_LABEL,
  formatQty,
} = await import("../src/lib/raw-materials.ts");

const SRC = path.join(process.cwd(), "src");
const read = (p) => fs.readFileSync(path.join(SRC, p), "utf8");

test("unit list matches raw_materials_unit_check, in order", () => {
  // Verbatim from the prod CHECK:
  //   CHECK ((unit = ANY (ARRAY['kg','g','l','ml','pcs','packet'])))
  // Written out longhand rather than derived from the constant, so a value
  // silently added to the constant fails here instead of reaching a <select>
  // the database will reject.
  assert.deepEqual([...RAW_MATERIAL_UNITS], [
    "kg",
    "g",
    "l",
    "ml",
    "pcs",
    "packet",
  ]);
});

test("isRawMaterialUnit refuses anything outside the CHECK", () => {
  for (const u of RAW_MATERIAL_UNITS) assert.equal(isRawMaterialUnit(u), true);
  // Plausible near-misses an operator or an old payload could send.
  for (const bad of ["KG", "kgs", "litre", "L", "pieces", "", " kg", null, 1, undefined]) {
    assert.equal(isRawMaterialUnit(bad), false, `accepted ${String(bad)}`);
  }
});

// ── needs_reorder is THREE-valued ─────────────────────────────────────────

test("reorderState keeps undecided out of ok", () => {
  assert.equal(reorderState(true), "below");
  assert.equal(reorderState(false), "ok");
  // The whole point: no reorder_level set means nobody decided, which is not
  // the same fact as "there is enough".
  assert.equal(reorderState(null), "undecided");
  // An omitted JSON key must land on undecided too — routes here drop nulls
  // via conditional spread, and the safe direction is the one that cannot
  // read as reassurance.
  assert.equal(reorderState(undefined), "undecided");
});

test("the three reorder states have three distinct labels", () => {
  const labels = Object.values(REORDER_LABEL);
  assert.equal(labels.length, 3);
  assert.equal(new Set(labels).size, 3);
  assert.notEqual(REORDER_LABEL.undecided, REORDER_LABEL.ok);
});

// ── blank must mean NULL, never 0 ─────────────────────────────────────────

test("blank reorder_level / lead_time_days normalise to null, not 0", () => {
  for (const blank of ["", null, undefined]) {
    const r = optionalNonNegativeNumber(blank);
    assert.equal(r.ok, true);
    assert.equal(r.value, null, `${String(blank)} became ${String(r.value)}`);
  }
  // 0 typed on purpose is a real level and must survive as 0 — it is what
  // moves a material OUT of undecided.
  assert.deepEqual(optionalNonNegativeNumber("0"), { ok: true, value: 0 });
  assert.equal(reorderState(false), "ok");
});

test("negative, unparseable and fractional-integer values are rejected", () => {
  for (const bad of ["-1", -0.5, "abc", "1kg", NaN, Infinity]) {
    assert.equal(
      optionalNonNegativeNumber(bad).ok,
      false,
      `accepted ${String(bad)}`,
    );
  }
  // lead_time_days is an integer column.
  assert.equal(optionalNonNegativeNumber("2.5", { integer: true }).ok, false);
  assert.equal(optionalNonNegativeNumber("2.5").ok, true);
});

// ── text normalisation ────────────────────────────────────────────────────

test("optionalText trims, blanks to null, and enforces the column ceiling", () => {
  assert.deepEqual(optionalText("  Flour  ", FIELD_LIMITS.category), {
    ok: true,
    value: "Flour",
  });
  assert.deepEqual(optionalText("   ", FIELD_LIMITS.category), {
    ok: true,
    value: null,
  });
  assert.equal(optionalText("x".repeat(60), 60).ok, true);
  assert.deepEqual(optionalText("x".repeat(61), 60), {
    ok: false,
    reason: "too_long",
  });
  // The ceiling applies to the TRIMMED value, because the CHECK is
  // length(btrim(col)) <= N.
  assert.equal(optionalText(`  ${"x".repeat(60)}  `, 60).ok, true);
});

test("freeText invents no ceiling for the uncapped columns", () => {
  // vendors.address, vendors.notes and raw_materials.notes carry no length
  // CHECK. A limit here would reject input the database accepts, with no
  // error the operator could discover.
  const long = "y".repeat(50_000);
  assert.equal(freeText(long), long);
  assert.equal(freeText("  "), null);
  assert.equal(freeText(undefined), null);
});

test("formatQty keeps zero distinct from no value", () => {
  // A material at exactly zero stock is real and urgent; it must not render
  // as the same em-dash that means "nothing recorded".
  assert.equal(formatQty(0), "0");
  assert.equal(formatQty("0"), "0");
  assert.equal(formatQty(null), "—");
  assert.equal(formatQty(""), "—");
  // numeric(14,3) arrives as a string often enough that this is the real case.
  assert.equal(formatQty("12.500"), "12.5");
  assert.equal(formatQty("12.000"), "12");
});

// ── the two DB rules, asserted against the source ─────────────────────────

test("nothing is ever deleted: no DELETE handler, no delete button", () => {
  const routes = [
    "app/api/admin/vendors/route.ts",
    "app/api/admin/vendors/[id]/route.ts",
    "app/api/admin/raw-materials/route.ts",
    "app/api/admin/raw-materials/[id]/route.ts",
  ];
  for (const r of routes) {
    // ON DELETE RESTRICT means a DELETE export could only ever 500 on a row
    // that matters and succeed on one that does not — is_active=false is the
    // soft delete.
    assert.equal(
      /export\s+async\s+function\s+DELETE/.test(read(r)),
      false,
      `${r} exports DELETE`,
    );
  }
  for (const p of ["app/admin/vendors/page.tsx", "app/admin/raw-materials/page.tsx"]) {
    assert.equal(/method:\s*"DELETE"/.test(read(p)), false, `${p} sends DELETE`);
  }
});

test("both screens can reach the inactive rows they create", () => {
  // A soft delete that hides the row with no way back is a delete. Both pages
  // load with include_inactive and offer the reverse action.
  for (const p of ["app/admin/vendors/page.tsx", "app/admin/raw-materials/page.tsx"]) {
    const src = read(p);
    assert.match(src, /include_inactive=1/, `${p} cannot see inactive rows`);
    assert.match(src, /Reactivate/, `${p} offers no way back`);
  }
});

test("a failed load never renders the empty-state copy", () => {
  // Found in the browser: with the load 500ing, both boards showed the error
  // AND "No raw materials yet" / "No vendors yet", because the state array is
  // [] after a failure exactly as it is on a genuinely empty table. The
  // sentence asserts a fact nobody has.
  for (const p of ["app/admin/vendors/page.tsx", "app/admin/raw-materials/page.tsx"]) {
    const src = read(p);
    assert.match(
      src,
      /\) : error \? \(/,
      `${p} has no error branch before the empty state`,
    );
    // The error branch must come BEFORE the length check, or it never runs.
    assert.ok(
      src.indexOf(") : error ? (") < src.indexOf("shown.length === 0"),
      `${p} checks emptiness before the error`,
    );
  }
});

test("stock is read from the view, never recomputed", () => {
  const src = read("app/api/admin/raw-materials/route.ts");
  assert.match(src, /from\("raw_material_stock"\)/);
  // And never cached: a stale stock figure reads as a current one.
  assert.match(src, /export const dynamic = "force-dynamic"/);
  assert.match(src, /export const revalidate = 0/);
  // stock_movements is the view's input, not this route's.
  assert.equal(/from\("stock_movements"\)/.test(src), false);
});

test("the unit lock is checked before the write, and only on a real change", () => {
  const src = read("app/api/admin/raw-materials/[id]/route.ts");
  // The courtesy 409, so the composite FK's refusal arrives as a sentence.
  assert.match(src, /production_batch_materials/);
  assert.match(src, /UNIT_LOCKED_REASON/);
  // Guarded on an ACTUAL change: re-saving a consumed material with the unit
  // untouched has to keep working.
  assert.match(src, /patch\.unit !== undefined && patch\.unit !== before\.unit/);
});

test("the form omits unit entirely when the material is locked", () => {
  const src = read("app/admin/raw-materials/page.tsx");
  assert.match(src, /unit_locked/);
  assert.match(src, /if \(!unitLocked\) payload\.unit = form\.unit/);
  // And says why, in the words the API would have used.
  assert.match(src, /UNIT_LOCKED_REASON/);
});

test("both screens are reachable from the nav", () => {
  // /admin/audit-log shipped with no nav entry and spent 146 days rendering
  // blank because the only way in was typing the URL.
  const shell = read("components/admin/AdminShell.tsx");
  assert.match(shell, /href: "\/admin\/raw-materials"/);
  assert.match(shell, /href: "\/admin\/vendors"/);
});
