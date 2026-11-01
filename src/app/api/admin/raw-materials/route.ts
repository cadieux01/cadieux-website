import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { queueAuditEvent } from "@/lib/audit-log";
import {
  codeError,
  isRawMaterialUnit,
  normalizeMaterialCode,
  optionalText,
  parseOptionalNonNegative,
  RAW_MATERIAL_UNITS,
} from "@/lib/raw-materials";

// Admin CRUD for `public.raw_materials`, listed through the
// `public.raw_material_stock` VIEW.
//
// WHY THE VIEW AND NOT THE TABLE FOR READS: current_qty and needs_reorder
// are the view's job. It sums stock_movements with the direction sign and
// compares the result to reorder_level in SQL. Re-deriving either of those
// in this handler would mean two definitions of "how much do we have", and
// the one on screen would be the one that drifts.
//
// NOT CACHED. force-dynamic below plus `cache: "no-store"` in adminFetch
// means a stock figure is never served from a previous request. Stock
// changes on every batch and every delivery; a cached quantity is a wrong
// quantity that looks authoritative.
export const dynamic = "force-dynamic";

const MATERIAL_SELECT =
  "id, code, name, unit, category, reorder_level, lead_time_days, vendor_id, is_active, notes, created_at, updated_at";

const STOCK_SELECT =
  "material_id, code, name, unit, category, reorder_level, lead_time_days, vendor_id, is_active, current_qty, movement_count, last_movement_at, needs_reorder";

// GET /api/admin/raw-materials?include_inactive=1
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("include_inactive") === "1";

  let query = supabaseAdmin
    .from("raw_material_stock")
    .select(STOCK_SELECT)
    .order("name", { ascending: true });

  if (!includeInactive) query = query.eq("is_active", true);

  const { data: materials, error } = await query;
  if (error) {
    console.error("[admin/raw-materials GET]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Vendor names come from a separate read rather than a PostgREST embed:
  // raw_material_stock is a view, so it carries no foreign-key metadata for
  // the embed to resolve. Inactive vendors are included — a material may
  // still point at one, and showing a blank where a name belongs reads as
  // "no vendor".
  const { data: vendors, error: vendorErr } = await supabaseAdmin
    .from("vendors")
    .select("id, name, is_active");
  if (vendorErr) {
    console.error("[admin/raw-materials GET vendors]", vendorErr.message);
    return NextResponse.json({ error: vendorErr.message }, { status: 500 });
  }

  const vendorById = new Map(
    (vendors ?? []).map((v) => [v.id, { name: v.name, is_active: v.is_active }]),
  );

  return NextResponse.json({
    materials: (materials ?? []).map((m) => ({
      ...m,
      vendor_name: m.vendor_id ? vendorById.get(m.vendor_id)?.name ?? null : null,
      vendor_is_active: m.vendor_id
        ? vendorById.get(m.vendor_id)?.is_active ?? null
        : null,
    })),
    units: RAW_MATERIAL_UNITS,
  });
}

// POST /api/admin/raw-materials
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  // Stored as typed apart from outer whitespace — see normalizeMaterialCode.
  const code = normalizeMaterialCode(body.code);
  const codeProblem = codeError(code);
  if (codeProblem) {
    return NextResponse.json({ error: codeProblem }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  if (!isRawMaterialUnit(body.unit)) {
    return NextResponse.json(
      { error: `unit must be one of: ${RAW_MATERIAL_UNITS.join(", ")}` },
      { status: 400 },
    );
  }

  const reorder = parseOptionalNonNegative(body.reorder_level, "Reorder level");
  if (!reorder.ok) {
    return NextResponse.json({ error: reorder.error }, { status: 400 });
  }
  const leadTime = parseOptionalNonNegative(body.lead_time_days, "Lead time", {
    integer: true,
  });
  if (!leadTime.ok) {
    return NextResponse.json({ error: leadTime.error }, { status: 400 });
  }

  const vendorId =
    typeof body.vendor_id === "string" && body.vendor_id.trim()
      ? body.vendor_id.trim()
      : null;

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("raw_materials")
    .insert({
      code,
      name,
      unit: body.unit,
      category: optionalText(body.category),
      reorder_level: reorder.value,
      lead_time_days: leadTime.value,
      vendor_id: vendorId,
      is_active: true,
      notes: optionalText(body.notes),
    })
    .select(MATERIAL_SELECT)
    .single();

  if (insertErr || !inserted) {
    // 23505 = unique_violation on raw_materials_code_key. The operator can
    // fix this themselves, so it is a 409 with the code echoed, not a 500.
    if (insertErr?.code === "23505") {
      return NextResponse.json(
        { error: `Code "${code}" is already in use`, code: "duplicate_code" },
        { status: 409 },
      );
    }
    // 23503 = the vendor_id FK. Means the vendor row vanished between the
    // form loading and this insert.
    if (insertErr?.code === "23503") {
      return NextResponse.json(
        { error: "That vendor no longer exists", code: "unknown_vendor" },
        { status: 409 },
      );
    }
    console.error("[admin/raw-materials POST]", insertErr?.message);
    return NextResponse.json(
      { error: insertErr?.message ?? "Insert failed" },
      { status: 500 },
    );
  }

  queueAuditEvent({
    req,
    entity: "other",
    action: "create",
    targetId: inserted.id,
    targetLabel: `${inserted.code} ${inserted.name}`,
    context: `Created raw material "${inserted.code} — ${inserted.name}"`,
    meta: { unit: inserted.unit },
  });

  return NextResponse.json({ material: inserted }, { status: 201 });
}
