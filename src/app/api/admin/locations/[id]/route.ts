import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";

// PATCH /api/admin/locations/[id] — partial update. Only fields
// present on the body are written; everything else is left alone.

const LOCATION_SELECT =
  "id, name, type, area, address, latitude, longitude, notes, pincode, google_place_id, sort_order, is_archived, archived_at, created_at, updated_at";

const TYPES = ["kitchen", "stall", "partner_pickup"] as const;
type PickupType = (typeof TYPES)[number];

function isPickupType(v: unknown): v is PickupType {
  return typeof v === "string" && (TYPES as readonly string[]).includes(v);
}

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
  if (body.type !== undefined) {
    if (!isPickupType(body.type)) {
      return NextResponse.json(
        { error: "type must be kitchen | stall | partner_pickup" },
        { status: 400 },
      );
    }
    patch.type = body.type;
  }
  if (typeof body.area === "string") {
    const v = body.area.trim();
    if (!v) {
      return NextResponse.json({ error: "area cannot be empty" }, { status: 400 });
    }
    patch.area = v;
  }
  if (typeof body.address === "string") {
    const v = body.address.trim();
    if (!v) {
      return NextResponse.json({ error: "address cannot be empty" }, { status: 400 });
    }
    patch.address = v;
  }
  if (body.latitude !== undefined) {
    const lat = Number(body.latitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return NextResponse.json(
        { error: "latitude must be between -90 and 90" },
        { status: 400 },
      );
    }
    patch.latitude = lat;
  }
  if (body.longitude !== undefined) {
    const lng = Number(body.longitude);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return NextResponse.json(
        { error: "longitude must be between -180 and 180" },
        { status: 400 },
      );
    }
    patch.longitude = lng;
  }
  if (body.notes !== undefined) {
    if (body.notes === null || (typeof body.notes === "string" && body.notes.trim() === "")) {
      patch.notes = null;
    } else if (typeof body.notes === "string") {
      patch.notes = body.notes.trim();
    } else {
      return NextResponse.json({ error: "notes must be a string or null" }, { status: 400 });
    }
  }
  if (body.sort_order !== undefined) {
    const n = Number(body.sort_order);
    if (!Number.isFinite(n)) {
      return NextResponse.json({ error: "sort_order must be a number" }, { status: 400 });
    }
    patch.sort_order = Math.trunc(n);
  }
  if (body.pincode !== undefined) {
    if (body.pincode === null || (typeof body.pincode === "string" && body.pincode.trim() === "")) {
      patch.pincode = null;
    } else if (typeof body.pincode === "string" && /^\d{6}$/.test(body.pincode.trim())) {
      patch.pincode = body.pincode.trim();
    } else {
      return NextResponse.json(
        { error: "pincode must be a 6-digit string or null" },
        { status: 400 },
      );
    }
  }
  if (body.google_place_id !== undefined) {
    if (body.google_place_id === null || (typeof body.google_place_id === "string" && body.google_place_id.trim() === "")) {
      patch.google_place_id = null;
    } else if (typeof body.google_place_id === "string") {
      patch.google_place_id = body.google_place_id.trim();
    } else {
      return NextResponse.json(
        { error: "google_place_id must be a string or null" },
        { status: 400 },
      );
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data: before } = await supabaseAdmin
    .from("pickup_locations")
    .select("id, name")
    .eq("id", params.id)
    .maybeSingle();
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: updated, error: updErr } = await supabaseAdmin
    .from("pickup_locations")
    .update(patch)
    .eq("id", params.id)
    .select(LOCATION_SELECT)
    .single();

  if (updErr || !updated) {
    console.error("[admin/locations PATCH]", updErr?.message);
    return NextResponse.json(
      { error: updErr?.message ?? "Update failed" },
      { status: 500 },
    );
  }

  revalidateTag("pickup-locations");

  void recordAuditEvent({
    req,
    entity: "other",
    action: "update",
    targetId: updated.id,
    targetLabel: updated.name,
    context: `Updated pickup location "${updated.name}"`,
    meta: { fields_changed: Object.keys(patch) },
  });

  return NextResponse.json({ location: updated });
}
