import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { queueAuditEvent } from "@/lib/audit-log";
import { optionalText } from "@/lib/raw-materials";

// Admin CRUD for `public.vendors` — the suppliers raw materials are bought
// from. Mirrors /api/admin/delivery-partners (isAdmin gate, supabaseAdmin,
// queueAuditEvent).
//
// WHY THIS IS A SERVER ROUTE AND NOT A BROWSER QUERY: vendors grants
// privileges to `service_role` ONLY — anon and authenticated have none — and
// carries an RLS policy `deny_anon_vendors_all` (USING false, WITH CHECK
// false). A supabase-js call from any logged-in browser session gets nothing
// back. The service-role key lives on this side of the wire, so this is the
// only place the table is reachable at all.
//
// NO DELETE VERB EXISTS ON PURPOSE. raw_materials.vendor_id is
// ON DELETE RESTRICT, and a vendor is referenced by purchase history that
// has to stay readable, so deactivation is the only retirement path:
// PATCH { is_active: false }.

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
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("vendors")
    .insert({
      name,
      contact_person: optionalText(body.contact_person),
      phone: optionalText(body.phone),
      whatsapp: optionalText(body.whatsapp),
      address: optionalText(body.address),
      notes: optionalText(body.notes),
      is_active: true,
    })
    .select(VENDOR_SELECT)
    .single();

  if (insertErr || !inserted) {
    console.error("[admin/vendors POST]", insertErr?.message);
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
    targetLabel: inserted.name,
    context: `Created vendor "${inserted.name}"`,
  });

  return NextResponse.json({ vendor: inserted }, { status: 201 });
}
