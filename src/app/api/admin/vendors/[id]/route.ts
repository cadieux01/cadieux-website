import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { queueAuditEvent } from "@/lib/audit-log";
import { FIELD_LIMITS, freeText, optionalText } from "@/lib/raw-materials";

// PATCH /api/admin/vendors/[id] — partial update. Only fields present on the
// body are written; everything else is left alone. Same shape as
// /api/admin/locations/[id].
//
// DEACTIVATION LIVES HERE, as `{ is_active: false }`, rather than in a
// separate ./deactivate route. locations and service-areas both use dedicated
// sub-routes, but they archive via a second column (archived_at) that has to
// be set in the same write. is_active is a single boolean, so a sub-route
// would be a third file that only ever sends one field — and routing the
// toggle through PATCH means reactivating is free rather than a fourth file.
// The audit trail still distinguishes them: the action is archive/unarchive,
// not update, whenever is_active moves.
//
// There is no DELETE export. See the note in ../route.ts.

const VENDOR_SELECT =
  "id, name, contact_person, phone, whatsapp, address, notes, is_active, created_at, updated_at";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

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

  if (body.contact_person !== undefined) {
    const r = optionalText(body.contact_person, FIELD_LIMITS.contactPerson);
    if (!r.ok) {
      return NextResponse.json(
        {
          error: `Contact person cannot be longer than ${FIELD_LIMITS.contactPerson} characters.`,
        },
        { status: 400 },
      );
    }
    patch.contact_person = r.value;
  }

  if (body.phone !== undefined) {
    const r = optionalText(body.phone, FIELD_LIMITS.phone);
    if (!r.ok) {
      return NextResponse.json(
        {
          error: `Phone cannot be longer than ${FIELD_LIMITS.phone} characters.`,
        },
        { status: 400 },
      );
    }
    patch.phone = r.value;
  }

  if (body.whatsapp !== undefined) {
    const r = optionalText(body.whatsapp, FIELD_LIMITS.whatsapp);
    if (!r.ok) {
      return NextResponse.json(
        {
          error: `WhatsApp number cannot be longer than ${FIELD_LIMITS.whatsapp} characters.`,
        },
        { status: 400 },
      );
    }
    patch.whatsapp = r.value;
  }

  if (body.address !== undefined) patch.address = freeText(body.address);
  if (body.notes !== undefined) patch.notes = freeText(body.notes);

  // The soft delete. Tracked separately from the field edits so the audit row
  // can name what actually happened.
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
    return NextResponse.json(
      { error: "Nothing to update." },
      { status: 400 },
    );
  }

  const { data: before } = await supabaseAdmin
    .from("vendors")
    .select("id, name, is_active")
    .eq("id", params.id)
    .maybeSingle();
  if (!before) {
    return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
  }

  // `updated_at` is deliberately NOT set here: the vendors_touch_updated_at
  // BEFORE UPDATE trigger owns it. Writing it from the app would be
  // overwritten anyway and would hide a stale clock.
  const { data: updated, error: updErr } = await supabaseAdmin
    .from("vendors")
    .update(patch)
    .eq("id", params.id)
    .select(VENDOR_SELECT)
    .single();

  if (updErr || !updated) {
    console.error("[admin/vendors PATCH]", updErr?.message);
    return NextResponse.json(
      { error: updErr?.message ?? "Could not save the vendor." },
      { status: 500 },
    );
  }

  const movedActive = activeChange !== null && activeChange !== before.is_active;

  queueAuditEvent({
    req,
    entity: "other",
    action: movedActive
      ? activeChange
        ? "unarchive"
        : "archive"
      : "update",
    targetId: updated.id,
    targetLabel: updated.name,
    context: movedActive
      ? activeChange
        ? `Reactivated vendor "${updated.name}"`
        : `Deactivated vendor "${updated.name}"`
      : `Updated vendor "${updated.name}"`,
    meta: { fields_changed: Object.keys(patch) },
  });

  return NextResponse.json({ vendor: updated });
}
