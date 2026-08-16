import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { normalizeWhatsAppPhone } from "@/lib/delivery-partner-phone";

// Admin CRUD for `delivery_partners` — the tiny operator-managed list
// of delivery riders the /admin/orders "Share" button dispatches to
// via wa.me. Mirrors the shape of /api/admin/locations (isAdmin gate,
// supabaseAdmin, recordAuditEvent).

const PARTNER_SELECT =
  "id, name, phone, is_active, sort_order, created_at, updated_at";

// GET /api/admin/delivery-partners?include_inactive=1
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("include_inactive") === "1";

  let query = supabaseAdmin
    .from("delivery_partners")
    .select(PARTNER_SELECT)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (!includeInactive) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) {
    console.error("[admin/delivery-partners GET]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ partners: data ?? [] });
}

// POST /api/admin/delivery-partners  { name, phone, sort_order? }
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const rawPhone = typeof body.phone === "string" ? body.phone.trim() : "";
  const normalizedPhone = normalizeWhatsAppPhone(rawPhone);

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!normalizedPhone) {
    return NextResponse.json(
      {
        error:
          "phone must be a valid WhatsApp number (10-digit Indian mobile or full country-coded number)",
      },
      { status: 400 },
    );
  }

  // Default sort_order = max + 10 (same idiom as /api/admin/locations).
  let sortOrder: number;
  if (typeof body.sort_order === "number" && Number.isFinite(body.sort_order)) {
    sortOrder = Math.trunc(body.sort_order);
  } else {
    const { data: maxRow } = await supabaseAdmin
      .from("delivery_partners")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    sortOrder = (maxRow?.sort_order ?? 0) + 10;
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("delivery_partners")
    .insert({
      name,
      // Store the normalized form so what we display and what we dial
      // are the same string — the operator's raw input isn't worth
      // preserving (single field, single purpose).
      phone: normalizedPhone,
      is_active: true,
      sort_order: sortOrder,
    })
    .select(PARTNER_SELECT)
    .single();

  if (insertErr || !inserted) {
    console.error("[admin/delivery-partners POST]", insertErr?.message);
    return NextResponse.json(
      { error: insertErr?.message ?? "Insert failed" },
      { status: 500 },
    );
  }

  void recordAuditEvent({
    req,
    entity: "other",
    action: "create",
    targetId: inserted.id,
    targetLabel: inserted.name,
    context: `Created delivery partner "${inserted.name}"`,
    meta: { phone: inserted.phone },
  });

  return NextResponse.json({ partner: inserted }, { status: 201 });
}
