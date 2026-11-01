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
  UNIT_LOCKED_REASON,
} from "@/lib/raw-materials";

// GET   /api/admin/raw-materials/[id] — one material + whether its unit is
//                                      still changeable.
// PATCH /api/admin/raw-materials/[id] — partial update, plus the deactivate
//                                      / reactivate switch via { is_active }.
//
// No DELETE handler: production_batch_materials references
// raw_materials(id, unit) ON DELETE RESTRICT, so a consumed material cannot
// be removed, and an unconsumed one is still a record somebody created.
// is_active=false is the only retirement path.
export const dynamic = "force-dynamic";

const MATERIAL_SELECT =
  "id, code, name, unit, category, reorder_level, lead_time_days, vendor_id, is_active, notes, created_at, updated_at";

// Has any production batch consumed this material?
//
// This is the authoritative answer to "may the unit change", and it is asked
// one material at a time ON PURPOSE. The obvious alternative — fetch every
// material_id in production_batch_materials once and keep a Set — is wrong
// here: PostgREST caps a response at 1000 rows, so past that ceiling the Set
// silently misses materials and the UI would offer an editable unit whose
// save is guaranteed to fail. A single `limit(1)` existence probe cannot be
// truncated into the wrong answer.
async function isConsumed(materialId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("production_batch_materials")
    .select("id")
    .eq("material_id", materialId)
    .limit(1);
  if (error) {
    // Fail CLOSED. If we cannot prove the unit is free to change, we treat
    // it as locked: the cost of a wrong "locked" is an operator who has to
    // ask, the cost of a wrong "unlocked" is a save that dies on a Postgres
    // foreign-key error after they filled in the form.
    console.error("[admin/raw-materials isConsumed]", error.message);
    return true;
  }
  return (data ?? []).length > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: material, error } = await supabaseAdmin
    .from("raw_materials")
    .select(MATERIAL_SELECT)
    .eq("id", params.id)
    .maybeSingle();

  if (error) {
    console.error("[admin/raw-materials GET one]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!material) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const consumed = await isConsumed(params.id);

  return NextResponse.json({
    material,
    // The editor disables the unit field on this flag, and shows
    // unit_locked_reason as the explanation.
    unit_locked: consumed,
    unit_locked_reason: consumed ? UNIT_LOCKED_REASON : null,
    units: RAW_MATERIAL_UNITS,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: before } = await supabaseAdmin
    .from("raw_materials")
    .select("id, code, name, unit, is_active")
    .eq("id", params.id)
    .maybeSingle();
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  if (body.code !== undefined) {
    const code = normalizeMaterialCode(body.code);
    const problem = codeError(code);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    patch.code = code;
  }

  if (body.name !== undefined) {
    const v = typeof body.name === "string" ? body.name.trim() : "";
    if (!v) {
      return NextResponse.json(
        { error: "name cannot be empty" },
        { status: 400 },
      );
    }
    patch.name = v;
  }

  // THE UNIT LOCK. Only enforced when the value actually changes — a form
  // that round-trips the same unit on a consumed material is a no-op, not a
  // violation, and refusing it would make the whole editor unusable for
  // every material that has ever been baked with.
  if (body.unit !== undefined && body.unit !== before.unit) {
    if (!isRawMaterialUnit(body.unit)) {
      return NextResponse.json(
        { error: `unit must be one of: ${RAW_MATERIAL_UNITS.join(", ")}` },
        { status: 400 },
      );
    }
    if (await isConsumed(params.id)) {
      return NextResponse.json(
        { error: UNIT_LOCKED_REASON, code: "unit_locked" },
        { status: 409 },
      );
    }
    patch.unit = body.unit;
  }

  if (body.category !== undefined) patch.category = optionalText(body.category);
  if (body.notes !== undefined) patch.notes = optionalText(body.notes);

  if (body.reorder_level !== undefined) {
    const parsed = parseOptionalNonNegative(body.reorder_level, "Reorder level");
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    patch.reorder_level = parsed.value;
  }

  if (body.lead_time_days !== undefined) {
    const parsed = parseOptionalNonNegative(body.lead_time_days, "Lead time", {
      integer: true,
    });
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    patch.lead_time_days = parsed.value;
  }

  if (body.vendor_id !== undefined) {
    patch.vendor_id =
      typeof body.vendor_id === "string" && body.vendor_id.trim()
        ? body.vendor_id.trim()
        : null;
  }

  if (body.is_active !== undefined) {
    if (typeof body.is_active !== "boolean") {
      return NextResponse.json(
        { error: "is_active must be a boolean" },
        { status: 400 },
      );
    }
    patch.is_active = body.is_active;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  patch.updated_at = new Date().toISOString();

  const { data: updated, error: updErr } = await supabaseAdmin
    .from("raw_materials")
    .update(patch)
    .eq("id", params.id)
    .select(MATERIAL_SELECT)
    .single();

  if (updErr || !updated) {
    if (updErr?.code === "23505") {
      return NextResponse.json(
        { error: `Code "${patch.code}" is already in use`, code: "duplicate_code" },
        { status: 409 },
      );
    }
    // 23503 on an UPDATE here is the composite FK refusing a unit change,
    // which means a batch consumed this material between the isConsumed
    // probe above and this statement. Rare, but it is a real race and the
    // operator should read the same sentence either way rather than a raw
    // constraint name.
    if (updErr?.code === "23503") {
      return NextResponse.json(
        { error: UNIT_LOCKED_REASON, code: "unit_locked" },
        { status: 409 },
      );
    }
    console.error("[admin/raw-materials PATCH]", updErr?.message);
    return NextResponse.json(
      { error: updErr?.message ?? "Update failed" },
      { status: 500 },
    );
  }

  const action =
    patch.is_active === false
      ? "archive"
      : patch.is_active === true && before.is_active === false
        ? "unarchive"
        : "update";

  queueAuditEvent({
    req,
    entity: "other",
    action,
    targetId: updated.id,
    targetLabel: `${updated.code} ${updated.name}`,
    context:
      action === "archive"
        ? `Deactivated raw material "${updated.code} — ${updated.name}"`
        : action === "unarchive"
          ? `Reactivated raw material "${updated.code} — ${updated.name}"`
          : `Updated raw material "${updated.code} — ${updated.name}"`,
    meta: { fields_changed: Object.keys(patch) },
  });

  return NextResponse.json({ material: updated });
}
