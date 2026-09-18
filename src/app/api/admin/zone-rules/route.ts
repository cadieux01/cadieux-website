// /api/admin/zone-rules
//
// GET  — list every rule + every row-override, newest updated_at first.
// POST — upsert a rule. Body: { key_type, key_input, zone, actor? }
//        The server normalises key_value from key_input; the client never
//        sends key_value directly. This is what makes the normaliser the
//        single source of truth for the write path — a client that skipped
//        normalisation would produce a rule that reads never matched.
//
// Auth: isAdmin() cookie/bearer, same as every other admin route.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import {
  isNumberedZone,
  type ZoneRowOverrideRow,
  type ZoneRuleRow,
} from "@/lib/zone-rules";
import { normaliseLocalityKey, normalisePincodeKey } from "@/lib/delivery-zones";

function normaliseActor(raw: unknown): string {
  if (typeof raw !== "string") return "admin";
  const t = raw.trim().slice(0, 60);
  return t.length > 0 ? t : "admin";
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [rulesRes, overridesRes] = await Promise.all([
    supabaseAdmin
      .from("delivery_zone_rules")
      .select("id, key_type, key_value, key_input, zone, created_by, created_at, updated_at")
      .order("updated_at", { ascending: false }),
    supabaseAdmin
      .from("delivery_zone_row_overrides")
      .select("id, order_id, subscription_id, zone, created_by, created_at, updated_at")
      .order("updated_at", { ascending: false }),
  ]);
  if (rulesRes.error) {
    console.error("[admin/zone-rules GET rules]", rulesRes.error.message);
    return NextResponse.json({ error: "Failed to load rules." }, { status: 500 });
  }
  if (overridesRes.error) {
    console.error("[admin/zone-rules GET overrides]", overridesRes.error.message);
    return NextResponse.json({ error: "Failed to load overrides." }, { status: 500 });
  }
  return NextResponse.json({
    rules: (rulesRes.data ?? []) as ZoneRuleRow[],
    overrides: (overridesRes.data ?? []) as ZoneRowOverrideRow[],
  });
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const key_type = body.key_type;
  if (key_type !== "pincode" && key_type !== "locality") {
    return NextResponse.json({ error: "key_type must be 'pincode' or 'locality'." }, { status: 400 });
  }
  const key_input_raw = typeof body.key_input === "string" ? body.key_input.trim() : "";
  if (!key_input_raw) {
    return NextResponse.json({ error: "key_input is required." }, { status: 400 });
  }
  if (key_input_raw.length > 120) {
    return NextResponse.json({ error: "key_input too long." }, { status: 400 });
  }

  const key_value =
    key_type === "pincode"
      ? normalisePincodeKey(key_input_raw)
      : normaliseLocalityKey(key_input_raw);
  if (!key_value) {
    return NextResponse.json(
      { error: key_type === "pincode" ? "Not a valid 6-digit pincode." : "Empty locality." },
      { status: 400 },
    );
  }

  const zone = body.zone;
  if (!isNumberedZone(zone)) {
    return NextResponse.json({ error: "zone must be zone1..zone4." }, { status: 400 });
  }

  const created_by = normaliseActor(body.actor);
  const now = new Date().toISOString();

  // Upsert on (key_type, key_value). DO UPDATE SET zone, key_input,
  // created_by, updated_at — NEVER created_at. See migration comment.
  const { data, error } = await supabaseAdmin
    .from("delivery_zone_rules")
    .upsert(
      {
        key_type,
        key_value,
        key_input: key_input_raw,
        zone,
        created_by,
        updated_at: now,
      },
      { onConflict: "key_type,key_value" },
    )
    .select("id, key_type, key_value, key_input, zone, created_by, created_at, updated_at")
    .single();
  if (error || !data) {
    console.error("[admin/zone-rules POST]", error?.message);
    return NextResponse.json({ error: "Failed to save rule." }, { status: 500 });
  }
  return NextResponse.json({ rule: data as ZoneRuleRow });
}
