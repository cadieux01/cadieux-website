// POST /api/admin/zone-row-overrides
//
// Body: { order_id? | subscription_id?, zone, actor? }
// Upserts on parent id — one override per row, reassignment updates the
// existing row (updated_at bumped, created_at preserved).
//
// This endpoint is the escape hatch for the ~7 orders whose address has
// neither pincode nor locality. The board only opens the row-override UI
// when pickRuleKey() returns null; a client that POSTs here with a row
// that HAS a keyable address will still succeed, but the resolver will
// consult the row-override before any rule and therefore override every
// pincode rule for that row too. That is the point — it is a pin.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { isNumberedZone, type ZoneRowOverrideRow } from "@/lib/zone-rules";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normaliseActor(raw: unknown): string {
  if (typeof raw !== "string") return "admin";
  const t = raw.trim().slice(0, 60);
  return t.length > 0 ? t : "admin";
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const orderId = typeof body.order_id === "string" ? body.order_id : null;
  const subId = typeof body.subscription_id === "string" ? body.subscription_id : null;
  if ((!orderId && !subId) || (orderId && subId)) {
    return NextResponse.json(
      { error: "Pass exactly one of order_id / subscription_id." },
      { status: 400 },
    );
  }
  const parentId = (orderId ?? subId) as string;
  if (!UUID_RE.test(parentId)) {
    return NextResponse.json({ error: "Invalid parent id." }, { status: 400 });
  }

  const zone = body.zone;
  if (!isNumberedZone(zone)) {
    return NextResponse.json({ error: "zone must be zone1..zone4." }, { status: 400 });
  }
  const created_by = normaliseActor(body.actor);
  const now = new Date().toISOString();

  const upsertRow = {
    order_id: orderId,
    subscription_id: subId,
    zone,
    created_by,
    updated_at: now,
  };

  // Upsert on the parent-id partial unique. Passing the correct
  // onConflict target keeps this a single UPDATE when a pin already
  // exists on that row — otherwise Postgres would fall through to
  // INSERT and hit the partial unique with a duplicate.
  const conflictTarget = orderId ? "order_id" : "subscription_id";
  const { data, error } = await supabaseAdmin
    .from("delivery_zone_row_overrides")
    .upsert(upsertRow, { onConflict: conflictTarget, ignoreDuplicates: false })
    .select("id, order_id, subscription_id, zone, created_by, created_at, updated_at")
    .single();
  if (error || !data) {
    console.error("[admin/zone-row-overrides POST]", error?.message);
    return NextResponse.json({ error: "Failed to save row pin." }, { status: 500 });
  }
  return NextResponse.json({ override: data as ZoneRowOverrideRow });
}
