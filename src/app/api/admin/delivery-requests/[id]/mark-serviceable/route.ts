// Admin: mark a delivery_request as serviceable. This is the "yes,
// we will deliver there now" button.
//
// Side effects:
//   1. Upserts a (pincode, area_name) row into service_areas with
//      is_active=true so the customer's checkout will succeed next time
//      they try.
//   2. Sends a WhatsApp message to the customer (best-effort).
//   3. Flips delivery_requests.status to 'serviceable'.
//   4. Records an audit event.

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { internalJsonHeaders } from "@/lib/internal-secret";
import { SERVICE_AREAS_TAG } from "@/lib/service-areas";

async function sendWhatsApp(req: NextRequest, phone: string, message: string) {
  try {
    // Re-use the existing /api/send-whatsapp helper so we get the same
    // Twilio config + masking semantics. Build an absolute URL so this
    // works from a route handler.
    const url = new URL("/api/send-whatsapp", req.nextUrl.origin);
    await fetch(url, {
      method: "POST",
      headers: internalJsonHeaders(),
      body: JSON.stringify({ phone, message }),
    });
  } catch (e) {
    console.warn("[delivery-requests] WhatsApp send failed:", String(e));
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    area_name?: unknown;
    note?: unknown;
  };
  const areaNameOverride =
    typeof body.area_name === "string" && body.area_name.trim()
      ? body.area_name.trim().slice(0, 120)
      : null;
  const note =
    typeof body.note === "string" && body.note.trim()
      ? body.note.trim().slice(0, 500)
      : null;

  // Load the request row.
  const { data: requestRow, error: loadErr } = await supabaseAdmin
    .from("delivery_requests")
    .select("id, phone, pincode, area_name, address, status")
    .eq("id", params.id)
    .maybeSingle();
  if (loadErr) {
    console.error("[delivery-requests] load failed:", loadErr.message);
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!requestRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const pincode = requestRow.pincode as string;
  const areaName = areaNameOverride ?? (requestRow.area_name as string | null) ?? "General";

  // Activate the pincode/area.
  const { error: upsertErr } = await supabaseAdmin
    .from("service_areas")
    .upsert(
      { pincode, area_name: areaName, is_active: true, added_by: "admin" },
      { onConflict: "pincode,area_name" },
    );
  if (upsertErr) {
    console.error("[delivery-requests] service_areas upsert failed:", upsertErr.message);
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }
  revalidateTag(SERVICE_AREAS_TAG);

  // Update the request row.
  const { error: updateErr } = await supabaseAdmin
    .from("delivery_requests")
    .update({
      status: "serviceable",
      area_name: areaName,
      resolved_at: new Date().toISOString(),
      resolved_by: "admin",
      resolution_note: note,
    })
    .eq("id", params.id);
  if (updateErr) {
    console.error("[delivery-requests] update failed:", updateErr.message);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Notify the customer on WhatsApp.
  const phone = requestRow.phone as string;
  const message = `Good news from Cadieux — we now deliver to your location (pincode ${pincode}, ${areaName}). Open the app or visit cadieux.in to complete your order.`;
  void sendWhatsApp(req, phone, message);

  void recordAuditEvent({
    req,
    entity: "delivery_request",
    action: "status_change",
    targetId: params.id,
    targetLabel: `Delivery request ${pincode}`,
    context: `Activated pincode ${pincode} (${areaName}) from delivery request and notified customer`,
    meta: { pincode, area_name: areaName, phone, note },
  });

  return NextResponse.json({ ok: true, pincode, area_name: areaName });
}
