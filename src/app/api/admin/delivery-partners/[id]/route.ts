import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { normalizeWhatsAppPhone } from "@/lib/delivery-partner-phone";

// PATCH /api/admin/delivery-partners/[id] — partial update.
// DELETE /api/admin/delivery-partners/[id] — soft delete (is_active=false).
// Hard-delete not exposed; the row stays for audit continuity.

const PARTNER_SELECT =
  "id, name, phone, is_active, sort_order, created_at, updated_at";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const v = body.name.trim();
    if (!v) {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }
    patch.name = v;
  }
  if (body.phone !== undefined) {
    const normalized = normalizeWhatsAppPhone(body.phone);
    if (!normalized) {
      return NextResponse.json(
        {
          error:
            "phone must be a valid WhatsApp number (10-digit Indian mobile or full country-coded number)",
        },
        { status: 400 },
      );
    }
    patch.phone = normalized;
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
  if (body.sort_order !== undefined) {
    const n = Number(body.sort_order);
    if (!Number.isFinite(n)) {
      return NextResponse.json(
        { error: "sort_order must be a number" },
        { status: 400 },
      );
    }
    patch.sort_order = Math.trunc(n);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Bump updated_at explicitly — the table has no ON UPDATE trigger.
  patch.updated_at = new Date().toISOString();

  const { data: before } = await supabaseAdmin
    .from("delivery_partners")
    .select("id, name")
    .eq("id", params.id)
    .maybeSingle();
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: updated, error: updErr } = await supabaseAdmin
    .from("delivery_partners")
    .update(patch)
    .eq("id", params.id)
    .select(PARTNER_SELECT)
    .single();

  if (updErr || !updated) {
    console.error("[admin/delivery-partners PATCH]", updErr?.message);
    return NextResponse.json(
      { error: updErr?.message ?? "Update failed" },
      { status: 500 },
    );
  }

  void recordAuditEvent({
    req,
    entity: "other",
    action: patch.is_active === false ? "archive" : "update",
    targetId: updated.id,
    targetLabel: updated.name,
    context: `Updated delivery partner "${updated.name}"`,
    meta: { fields_changed: Object.keys(patch) },
  });

  return NextResponse.json({ partner: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: before } = await supabaseAdmin
    .from("delivery_partners")
    .select("id, name, is_active")
    .eq("id", params.id)
    .maybeSingle();
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Soft delete: flip is_active off + refresh updated_at. Keeps history
  // + lets us un-archive from the UI. Matches Stage-0 report choice.
  const { data: updated, error: updErr } = await supabaseAdmin
    .from("delivery_partners")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select(PARTNER_SELECT)
    .single();

  if (updErr || !updated) {
    console.error("[admin/delivery-partners DELETE]", updErr?.message);
    return NextResponse.json(
      { error: updErr?.message ?? "Archive failed" },
      { status: 500 },
    );
  }

  void recordAuditEvent({
    req,
    entity: "other",
    action: "archive",
    targetId: updated.id,
    targetLabel: updated.name,
    context: `Archived delivery partner "${updated.name}"`,
  });

  return NextResponse.json({ partner: updated });
}
