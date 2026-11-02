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
  UNIT_LOCKED_REASON,
} from "@/lib/raw-materials";

// PATCH /api/admin/raw-materials/[id] — partial update, same shape as
// /api/admin/locations/[id]. Deactivation is `{ is_active: false }`; see the
// note in ../../vendors/[id]/route.ts for why it is not a sub-route.
//
// THE UNIT RULE IS THE DATABASE'S, NOT THIS ROUTE'S.
// production_batch_materials(material_id, unit) references
// raw_materials(id, unit) ON UPDATE RESTRICT, so once a material has been
// consumed Postgres refuses to let its unit change. This route does not
// re-implement that rule and does not try to decide when it applies — it
// checks whether any consuming row exists purely so the refusal arrives as a
// sentence an operator can act on, instead of
// "update or delete on table violates foreign key constraint". If this check
// is ever wrong, the constraint still stops the write; the 409 below is a
// courtesy, not the guard.

const MATERIAL_SELECT =
  "id, code, name, unit, category, reorder_level, lead_time_days, vendor_id, is_active, notes, created_at, updated_at";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  if (body.code !== undefined) {
    // Stored as typed: trim only, never re-cased.
    const v = typeof body.code === "string" ? body.code.trim() : "";
    if (!v) {
      return NextResponse.json(
        { error: "Code cannot be empty." },
        { status: 400 },
      );
    }
    if (v.length > FIELD_LIMITS.code) {
      return NextResponse.json(
        {
          error: `Code cannot be longer than ${FIELD_LIMITS.code} characters.`,
        },
        { status: 400 },
      );
    }
    patch.code = v;
  }

  if (body.name !== undefined) {
    const v = typeof body.name === "string" ? body.name.trim() : "";
    if (!v) {
      return NextResponse.json(
        { error: "Name cannot be empty." },
        { status: 400 },
      );
    }
    if (v.length > FIELD_LIMITS.name) {
      return NextResponse.json(
        {
          error: `Name cannot be longer than ${FIELD_LIMITS.name} characters.`,
        },
        { status: 400 },
      );
    }
    patch.name = v;
  }

  if (body.unit !== undefined) {
    if (!isRawMaterialUnit(body.unit)) {
      return NextResponse.json(
        { error: `Unit must be one of: ${RAW_MATERIAL_UNITS.join(", ")}.` },
        { status: 400 },
      );
    }
    patch.unit = body.unit;
  }

  if (body.category !== undefined) {
    const r = optionalText(body.category, FIELD_LIMITS.category);
    if (!r.ok) {
      return NextResponse.json(
        {
          error: `Category cannot be longer than ${FIELD_LIMITS.category} characters.`,
        },
        { status: 400 },
      );
    }
    patch.category = r.value;
  }

  if (body.reorder_level !== undefined) {
    const r = optionalNonNegativeNumber(body.reorder_level);
    if (!r.ok) {
      return NextResponse.json(
        {
          error: "Reorder level must be a number of 0 or more, or left blank.",
        },
        { status: 400 },
      );
    }
    patch.reorder_level = r.value;
  }

  if (body.lead_time_days !== undefined) {
    const r = optionalNonNegativeNumber(body.lead_time_days, {
      integer: true,
    });
    if (!r.ok) {
      return NextResponse.json(
        {
          error:
            "Lead time must be a whole number of days, 0 or more, or left blank.",
        },
        { status: 400 },
      );
    }
    patch.lead_time_days = r.value;
  }

  if (body.vendor_id !== undefined) {
    patch.vendor_id =
      typeof body.vendor_id === "string" && body.vendor_id.trim()
        ? body.vendor_id.trim()
        : null;
  }

  if (body.notes !== undefined) patch.notes = freeText(body.notes);

  let activeChange: boolean | null = null;
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== "boolean") {
      return NextResponse.json(
        { error: "is_active must be true or false." },
        { status: 400 },
      );
    }
    patch.is_active = body.is_active;
    activeChange = body.is_active;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { data: before } = await supabaseAdmin
    .from("raw_materials")
    .select("id, code, name, unit, is_active")
    .eq("id", params.id)
    .maybeSingle();
  if (!before) {
    return NextResponse.json({ error: "Material not found." }, { status: 404 });
  }

  // Only a REAL change of unit is blocked. Re-saving the form with the unit
  // untouched must keep working on a consumed material, which it would not if
  // the mere presence of the key were treated as an attempt to change it.
  if (patch.unit !== undefined && patch.unit !== before.unit) {
    const { count, error: countErr } = await supabaseAdmin
      .from("production_batch_materials")
      .select("id", { count: "exact", head: true })
      .eq("material_id", params.id);

    // A FAILED COUNT IS TREATED AS LOCKED. The question "has this material been
    // consumed" has two answers, and an error is neither of them — so the only
    // thing known here is that the material cannot be shown to be unconsumed.
    // Letting the write through would hand the decision to the constraint and
    // surface it as "violates foreign key constraint"; returning a 500 with the
    // raw Postgres string would read as transient and invite a retry of an edit
    // that may be permanently impossible. The real cause goes to the log, where
    // it is recoverable, and the operator gets the sentence that is true in
    // every case the count might have been about to return.
    if (countErr) {
      console.error("[admin/raw-materials PATCH] consumed check", countErr.message);
      return NextResponse.json(
        { error: UNIT_LOCKED_REASON, code: "unit_locked" },
        { status: 409 },
      );
    }
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: UNIT_LOCKED_REASON, code: "unit_locked" },
        { status: 409 },
      );
    }
  }

  // `updated_at` is left alone: raw_materials_touch_updated_at owns it.
  const { data: updated, error: updErr } = await supabaseAdmin
    .from("raw_materials")
    .update(patch)
    .eq("id", params.id)
    .select(MATERIAL_SELECT)
    .single();

  if (updErr || !updated) {
    if (updErr?.code === "23505") {
      return NextResponse.json(
        { error: `A material with the code "${patch.code}" already exists.` },
        { status: 409 },
      );
    }
    if (updErr?.code === "23503") {
      // Either the vendor vanished, or the composite FK refused the unit
      // change because a batch consumed this material between the check above
      // and this write. Both are foreign-key refusals; the unit one is the
      // one worth naming, because it is permanent rather than a retry.
      const msg =
        patch.unit !== undefined && patch.unit !== before.unit
          ? UNIT_LOCKED_REASON
          : "That vendor no longer exists. Pick another one.";
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    console.error("[admin/raw-materials PATCH]", updErr?.message);
    return NextResponse.json(
      { error: updErr?.message ?? "Could not save the material." },
      { status: 500 },
    );
  }

  const movedActive =
    activeChange !== null && activeChange !== before.is_active;
  const label = `${updated.code} — ${updated.name}`;

  queueAuditEvent({
    req,
    entity: "other",
    action: movedActive ? (activeChange ? "unarchive" : "archive") : "update",
    targetId: updated.id,
    targetLabel: label,
    context: movedActive
      ? activeChange
        ? `Reactivated raw material "${label}"`
        : `Deactivated raw material "${label}"`
      : `Updated raw material "${label}"`,
    meta: { fields_changed: Object.keys(patch) },
  });

  return NextResponse.json({ material: updated });
}
