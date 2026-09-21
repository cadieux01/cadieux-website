// POST /api/admin/zone-row-overrides
//
// Body: { order_id? | subscription_id?, zone, actor? }
// One override per row: an existing pin is UPDATEd in place (updated_at
// bumped, created_at preserved), otherwise a row is INSERTed.
//
// This endpoint is the escape hatch for the ~7 orders whose address has
// neither pincode nor locality. The board only opens the row-override UI
// when pickRuleKey() returns null; a client that POSTs here with a row
// that HAS a keyable address will still succeed, but the resolver will
// consult the row-override before any rule and therefore override every
// pincode rule for that row too. That is the point — it is a pin.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { describeDbError } from "@/lib/db-error";
import { isNumberedZone, type ZoneRowOverrideRow } from "@/lib/zone-rules";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLS =
  "id, order_id, subscription_id, zone, created_by, created_at, updated_at";

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

  // UPDATE-then-INSERT rather than upsert. `upsert(..., { onConflict:
  // "order_id" })` emits `ON CONFLICT (order_id)`, and Postgres cannot infer
  // a PARTIAL unique index from a bare column list — it raised 42P10 on every
  // single call, so this table never took a row. Matching the index would mean
  // spelling out its WHERE predicate, which PostgREST cannot express, so the
  // write is split in two instead. No migration needed.
  const parentColumn = orderId ? "order_id" : "subscription_id";

  const tryUpdate = () =>
    supabaseAdmin
      .from("delivery_zone_row_overrides")
      // created_by is overwritten on purpose: it matches what the old upsert
      // did, and on a reassignment the useful name is whoever set the zone
      // that is live now. created_at is untouched, so the row keeps its age.
      .update({ zone, created_by, updated_at: now })
      .eq(parentColumn, parentId)
      .select(COLS)
      .maybeSingle();

  const updated = await tryUpdate();
  if (updated.error) {
    return failed("update", updated.error);
  }
  if (updated.data) {
    return NextResponse.json({ override: updated.data as ZoneRowOverrideRow });
  }

  const inserted = await supabaseAdmin
    .from("delivery_zone_row_overrides")
    .insert({ order_id: orderId, subscription_id: subId, zone, created_by, updated_at: now })
    .select(COLS)
    .single();
  if (inserted.error) {
    // 23505 = a pin for this row appeared between the UPDATE and this INSERT
    // (a double-clicked dialog is enough). The partial unique did its job;
    // re-run the update so the last click still wins.
    if (inserted.error.code === "23505") {
      const retry = await tryUpdate();
      if (!retry.error && retry.data) {
        return NextResponse.json({ override: retry.data as ZoneRowOverrideRow });
      }
      return failed("insert-retry", retry.error ?? inserted.error);
    }
    return failed("insert", inserted.error);
  }
  return NextResponse.json({ override: inserted.data as ZoneRowOverrideRow });
}

function failed(
  stage: string,
  error: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null,
) {
  console.error(`[admin/zone-row-overrides POST:${stage}]`, error);
  const detail = describeDbError(error, "the database returned no row");
  return NextResponse.json(
    {
      error: `Could not save row pin — ${detail}`,
      code: error?.code ?? null,
      details: error?.details ?? null,
      hint: error?.hint ?? null,
    },
    { status: 500 },
  );
}
