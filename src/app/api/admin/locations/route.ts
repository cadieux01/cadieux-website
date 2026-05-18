import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";

// Admin CRUD for pickup_locations. Mirrors the conventions of
// /api/admin/products: isAdmin gate, supabaseAdmin client, audit log
// + revalidateTag("pickup-locations") after every write.

const LOCATION_SELECT =
  "id, name, type, area, address, latitude, longitude, notes, sort_order, is_archived, archived_at, created_at, updated_at";

const TYPES = ["kitchen", "stall", "partner_pickup"] as const;
type PickupType = (typeof TYPES)[number];

function isPickupType(v: unknown): v is PickupType {
  return typeof v === "string" && (TYPES as readonly string[]).includes(v);
}

// GET /api/admin/locations?include_archived=1
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("include_archived") === "1";

  let query = supabaseAdmin
    .from("pickup_locations")
    .select(LOCATION_SELECT)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (!includeArchived) query = query.eq("is_archived", false);

  const { data, error } = await query;
  if (error) {
    console.error("[admin/locations GET]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ locations: data ?? [] });
}

// POST /api/admin/locations
//   { name, type, area, address, latitude, longitude, notes?, sort_order? }
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const area = typeof body.area === "string" ? body.area.trim() : "";
  const address = typeof body.address === "string" ? body.address.trim() : "";
  const type = body.type;
  const lat = Number(body.latitude);
  const lng = Number(body.longitude);
  const notes =
    typeof body.notes === "string" && body.notes.trim().length > 0
      ? body.notes.trim()
      : null;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!isPickupType(type)) {
    return NextResponse.json(
      { error: "type must be kitchen | stall | partner_pickup" },
      { status: 400 },
    );
  }
  if (!area) {
    return NextResponse.json({ error: "area is required" }, { status: 400 });
  }
  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return NextResponse.json(
      { error: "latitude must be between -90 and 90" },
      { status: 400 },
    );
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return NextResponse.json(
      { error: "longitude must be between -180 and 180" },
      { status: 400 },
    );
  }

  // Default sort_order: max + 10 so manual reordering has room to
  // breathe without renumbering siblings.
  let sortOrder: number;
  if (typeof body.sort_order === "number" && Number.isFinite(body.sort_order)) {
    sortOrder = Math.trunc(body.sort_order);
  } else {
    const { data: maxRow } = await supabaseAdmin
      .from("pickup_locations")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    sortOrder = (maxRow?.sort_order ?? 0) + 10;
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("pickup_locations")
    .insert({
      name,
      type,
      area,
      address,
      latitude: lat,
      longitude: lng,
      notes,
      sort_order: sortOrder,
      is_archived: false,
    })
    .select(LOCATION_SELECT)
    .single();

  if (insertErr || !inserted) {
    console.error("[admin/locations POST]", insertErr?.message);
    return NextResponse.json(
      { error: insertErr?.message ?? "Insert failed" },
      { status: 500 },
    );
  }

  revalidateTag("pickup-locations");

  void recordAuditEvent({
    req,
    entity: "other",
    action: "create",
    targetId: inserted.id,
    targetLabel: inserted.name,
    context: `Created pickup location "${inserted.name}"`,
    meta: {
      type: inserted.type,
      area: inserted.area,
      latitude: inserted.latitude,
      longitude: inserted.longitude,
    },
  });

  return NextResponse.json({ location: inserted }, { status: 201 });
}
