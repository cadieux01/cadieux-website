import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { queueAuditEvent } from "@/lib/audit-log";
import { optionalText } from "@/lib/raw-materials";

// PATCH /api/admin/vendors/[id] — partial update, and the deactivate /
// reactivate switch via { is_active }.
//
// There is deliberately NO DELETE handler. See the header of ../route.ts:
// raw_materials.vendor_id is ON DELETE RESTRICT and the row is history.

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
        { error: "name cannot be empty" },
        { status: 400 },
      );
    }
    patch.name = v;
  }

  // These five are nullable, so `undefined` means "not submitted" while an
  // empty string means "cleared" and must land as NULL (every one carries a
  // length >= 1 CHECK, so "" would be rejected by the table).
  for (const field of [
    "contact_person",
    "phone",
    "whatsapp",
    "address",
    "notes",
  ] as const) {
    if (body[field] !== undefined) patch[field] = optionalText(body[field]);
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

  const { data: before } = await supabaseAdmin
    .from("vendors")
    .select("id, name, is_active")
    .eq("id", params.id)
    .maybeSingle();
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: updated, error: updErr } = await supabaseAdmin
    .from("vendors")
    .update(patch)
    .eq("id", params.id)
    .select(VENDOR_SELECT)
    .single();

  if (updErr || !updated) {
    console.error("[admin/vendors PATCH]", updErr?.message);
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
    targetLabel: updated.name,
    context:
      action === "archive"
        ? `Deactivated vendor "${updated.name}"`
        : action === "unarchive"
          ? `Reactivated vendor "${updated.name}"`
          : `Updated vendor "${updated.name}"`,
    meta: { fields_changed: Object.keys(patch) },
  });

  return NextResponse.json({ vendor: updated });
}
