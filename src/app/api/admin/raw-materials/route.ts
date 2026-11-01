import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { queueAuditEvent } from "@/lib/audit-log";
import {
  FIELD_LIMITS,
  freeText,
  isRawMaterialUnit,
  optionalNonNegativeNumber,
  optionalText,
  RAW_MATERIAL_UNITS,
  type RawMaterialAdminRow,
  type RawMaterialStockRow,
} from "@/lib/raw-materials";

// Admin CRUD for `raw_materials` (phase-1 schema, migration 20261031131218).
// Conventions follow /api/admin/locations: isAdmin gate, supabaseAdmin
// client, explicit SELECT lists, queueAuditEvent after writes.
//
// NO DELETE EXPORT, DELIBERATELY. Materials are never deleted:
// production_batch_materials references them ON DELETE RESTRICT, so anything
// ever consumed cannot be removed, and the row is the only record of what a
// past batch was made from. is_active=false is the soft delete, on PATCH.

// Stock is read, never computed. Every figure below comes from the
// raw_material_stock VIEW, which derives current_qty from stock_movements and
// returns needs_reorder as a THREE-valued column (NULL when no reorder_level
// is set). Recomputing any of it here would create a second answer that could
// disagree with the view.
const STOCK_SELECT =
  "material_id, code, name, unit, category, reorder_level, lead_time_days, vendor_id, is_active, current_qty, movement_count, last_movement_at, needs_reorder";

const MATERIAL_SELECT =
  "id, code, name, unit, category, reorder_level, lead_time_days, vendor_id, is_active, notes, created_at, updated_at";

// Stock must never be served from a cache: a figure that is even one batch
// stale is worse than no figure, because it reads as current. The client side
// is already covered (adminFetch sends cache: "no-store"); these two make the
// route itself dynamic so no layer in between can hold a response.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/admin/raw-materials?include_inactive=1
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("include_inactive") === "1";

  let stockQuery = supabaseAdmin
    .from("raw_material_stock")
    .select(STOCK_SELECT)
    .order("name", { ascending: true });

  if (!includeInactive) stockQuery = stockQuery.eq("is_active", true);

  const { data: stockRows, error: stockErr } = await stockQuery;
  if (stockErr) {
    console.error("[admin/raw-materials GET] view", stockErr.message);
    return NextResponse.json({ error: stockErr.message }, { status: 500 });
  }

  const rows = (stockRows ?? []) as unknown as RawMaterialStockRow[];
  const ids = rows.map((r) => r.material_id);

  if (ids.length === 0) {
    return NextResponse.json({ materials: [], units: RAW_MATERIAL_UNITS });
  }

  // `notes` is NOT a column of raw_material_stock, so it comes from the base
  // table and is merged in. Reading the whole form from the view and then
  // discovering notes missing is exactly the absent-column-reads-as-blank
  // failure that has bitten this codebase before, so the two reads are
  // explicit rather than implied.
  const [notesRes, lockedRes, vendorRes] = await Promise.all([
    supabaseAdmin.from("raw_materials").select("id, notes").in("id", ids),
    // Which materials have been CONSUMED. This is what makes `unit`
    // uneditable: production_batch_materials(material_id, unit) references
    // raw_materials(id, unit) ON UPDATE RESTRICT, so once a row exists here
    // Postgres refuses the unit change. The UI needs the answer up front to
    // disable the field instead of letting the save fail.
    //
    // Deliberately NOT limited. A cap would under-report locks and the form
    // would offer an edit the database is going to reject.
    supabaseAdmin
      .from("production_batch_materials")
      .select("material_id")
      .in("material_id", ids),
    supabaseAdmin.from("vendors").select("id, name"),
  ]);

  if (notesRes.error || lockedRes.error || vendorRes.error) {
    const msg =
      notesRes.error?.message ??
      lockedRes.error?.message ??
      vendorRes.error?.message ??
      "Could not load raw materials.";
    console.error("[admin/raw-materials GET] merge", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const notesById = new Map<string, string | null>(
    (notesRes.data ?? []).map((r) => [r.id as string, r.notes as string | null]),
  );
  const lockedIds = new Set<string>(
    (lockedRes.data ?? []).map((r) => r.material_id as string),
  );
  const vendorNameById = new Map<string, string>(
    (vendorRes.data ?? []).map((v) => [v.id as string, v.name as string]),
  );

  const materials: RawMaterialAdminRow[] = rows.map((r) => ({
    ...r,
    notes: notesById.get(r.material_id) ?? null,
    vendor_name: r.vendor_id
      ? vendorNameById.get(r.vendor_id) ?? null
      : null,
    unit_locked: lockedIds.has(r.material_id),
  }));

  // The unit list travels with the payload so the form never has to guess it.
  return NextResponse.json({ materials, units: RAW_MATERIAL_UNITS });
}

// POST /api/admin/raw-materials
//   { code, name, unit, category?, reorder_level?, lead_time_days?,
//     vendor_id?, notes? }
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  // `code` is stored AS TYPED — no upper-casing, no slug rewriting. Only
  // surrounding whitespace is removed, because raw_materials_code_check
  // requires `code = btrim(code)` and would otherwise reject the row with a
  // constraint error the operator cannot act on.
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) {
    return NextResponse.json({ error: "Code is required." }, { status: 400 });
  }
  if (code.length > FIELD_LIMITS.code) {
    return NextResponse.json(
      { error: `Code cannot be longer than ${FIELD_LIMITS.code} characters.` },
      { status: 400 },
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (name.length > FIELD_LIMITS.name) {
    return NextResponse.json(
      { error: `Name cannot be longer than ${FIELD_LIMITS.name} characters.` },
      { status: 400 },
    );
  }

  if (!isRawMaterialUnit(body.unit)) {
    return NextResponse.json(
      { error: `Unit must be one of: ${RAW_MATERIAL_UNITS.join(", ")}.` },
      { status: 400 },
    );
  }

  const category = optionalText(body.category, FIELD_LIMITS.category);
  if (!category.ok) {
    return NextResponse.json(
      {
        error: `Category cannot be longer than ${FIELD_LIMITS.category} characters.`,
      },
      { status: 400 },
    );
  }

  const reorderLevel = optionalNonNegativeNumber(body.reorder_level);
  if (!reorderLevel.ok) {
    return NextResponse.json(
      { error: "Reorder level must be a number of 0 or more, or left blank." },
      { status: 400 },
    );
  }

  const leadTime = optionalNonNegativeNumber(body.lead_time_days, {
    integer: true,
  });
  if (!leadTime.ok) {
    return NextResponse.json(
      {
        error:
          "Lead time must be a whole number of days, 0 or more, or left blank.",
      },
      { status: 400 },
    );
  }

  const vendorId = typeof body.vendor_id === "string" && body.vendor_id.trim()
    ? body.vendor_id.trim()
    : null;

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("raw_materials")
    .insert({
      code,
      name,
      unit: body.unit,
      category: category.value,
      reorder_level: reorderLevel.value,
      lead_time_days: leadTime.value,
      vendor_id: vendorId,
      notes: freeText(body.notes),
      is_active: true,
    })
    .select(MATERIAL_SELECT)
    .single();

  if (insertErr || !inserted) {
    // 23505 is the UNIQUE(code) violation. Named here because "duplicate key
    // value violates unique constraint" tells an operator nothing about which
    // field to fix.
    if (insertErr?.code === "23505") {
      return NextResponse.json(
        { error: `A material with the code "${code}" already exists.` },
        { status: 409 },
      );
    }
    // 23503 is the vendor_id foreign key.
    if (insertErr?.code === "23503") {
      return NextResponse.json(
        { error: "That vendor no longer exists. Pick another one." },
        { status: 400 },
      );
    }
    console.error("[admin/raw-materials POST]", insertErr?.message);
    return NextResponse.json(
      { error: insertErr?.message ?? "Could not save the material." },
      { status: 500 },
    );
  }

  queueAuditEvent({
    req,
    entity: "other",
    action: "create",
    targetId: inserted.id,
    targetLabel: `${inserted.code} — ${inserted.name}`,
    context: `Created raw material "${inserted.code} — ${inserted.name}"`,
    meta: { unit: inserted.unit, vendor_id: inserted.vendor_id },
  });

  return NextResponse.json({ material: inserted }, { status: 201 });
}
