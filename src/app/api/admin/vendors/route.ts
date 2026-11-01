import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { queueAuditEvent } from "@/lib/audit-log";
import { FIELD_LIMITS, freeText, optionalText } from "@/lib/raw-materials";

// Admin CRUD for the `vendors` table (phase-1 raw-materials schema,
// migration 20261031131218). Mirrors /api/admin/locations: isAdmin gate,
// supabaseAdmin client, explicit SELECT list, queueAuditEvent after writes.
//
// NO revalidateTag here, unlike locations. Nothing public renders vendors —
// they are kitchen reference data — so there is no tagged cache to invalidate,
// and adding one would imply a public surface that does not exist.
//
// NO DELETE EXPORT, DELIBERATELY. Vendors are never deleted: raw_materials
// .vendor_id is ON DELETE RESTRICT, so a vendor with materials cannot be
// removed at all, and one without them still carries history worth keeping.
// is_active=false is the soft delete, and it lives on PATCH in ./[id].

const VENDOR_SELECT =
  "id, name, contact_person, phone, whatsapp, address, notes, is_active, created_at, updated_at";

// GET /api/admin/vendors?include_inactive=1
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("include_inactive") === "1";

  let query = supabaseAdmin
    .from("vendors")
    .select(VENDOR_SELECT)
    .order("name", { ascending: true });

  if (!includeInactive) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) {
    console.error("[admin/vendors GET]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ vendors: data ?? [] });
}

// POST /api/admin/vendors
//   { name, contact_person?, phone?, whatsapp?, address?, notes? }
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

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

  const contactPerson = optionalText(
    body.contact_person,
    FIELD_LIMITS.contactPerson,
  );
  if (!contactPerson.ok) {
    return NextResponse.json(
      {
        error: `Contact person cannot be longer than ${FIELD_LIMITS.contactPerson} characters.`,
      },
      { status: 400 },
    );
  }

  const phone = optionalText(body.phone, FIELD_LIMITS.phone);
  if (!phone.ok) {
    return NextResponse.json(
      {
        error: `Phone cannot be longer than ${FIELD_LIMITS.phone} characters.`,
      },
      { status: 400 },
    );
  }

  const whatsapp = optionalText(body.whatsapp, FIELD_LIMITS.whatsapp);
  if (!whatsapp.ok) {
    return NextResponse.json(
      {
        error: `WhatsApp number cannot be longer than ${FIELD_LIMITS.whatsapp} characters.`,
      },
      { status: 400 },
    );
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("vendors")
    .insert({
      name,
      contact_person: contactPerson.value,
      phone: phone.value,
      whatsapp: whatsapp.value,
      address: freeText(body.address),
      notes: freeText(body.notes),
      is_active: true,
    })
    .select(VENDOR_SELECT)
    .single();

  if (insertErr || !inserted) {
    console.error("[admin/vendors POST]", insertErr?.message);
    return NextResponse.json(
      { error: insertErr?.message ?? "Could not save the vendor." },
      { status: 500 },
    );
  }

  queueAuditEvent({
    req,
    entity: "other",
    action: "create",
    targetId: inserted.id,
    targetLabel: inserted.name,
    context: `Created vendor "${inserted.name}"`,
    meta: { phone: inserted.phone, contact_person: inserted.contact_person },
  });

  return NextResponse.json({ vendor: inserted }, { status: 201 });
}
