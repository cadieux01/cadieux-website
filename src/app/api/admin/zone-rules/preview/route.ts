// GET /api/admin/zone-rules/preview?key_type=&key_input=&zone=
//
// Returns the global blast radius of applying (or removing) a rule.
//
// Params:
//   key_type  — 'pincode' | 'locality'
//   key_input — the raw string the operator entered (normalised server-side
//               so the preview uses the SAME key_value the write would).
//   zone      — 'zone1'..'zone4' to apply the rule with that zone, OR
//               empty / 'clear' to preview the removal of an existing rule.
//
// Response: { before, after, moved, matchingRows }
// where before/after are zone-count objects and moved is the number of rows
// whose zone changes. The board renders "moves N other orders" from `moved`
// (minus 1 if the current row is itself in the moved set).

import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { normaliseLocalityKey, normalisePincodeKey } from "@/lib/delivery-zones";
import { isNumberedZone, previewRuleChange } from "@/lib/zone-rules";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const key_type = sp.get("key_type");
  if (key_type !== "pincode" && key_type !== "locality") {
    return NextResponse.json({ error: "key_type must be 'pincode' or 'locality'." }, { status: 400 });
  }
  const key_input = (sp.get("key_input") ?? "").trim();
  if (!key_input) {
    return NextResponse.json({ error: "key_input is required." }, { status: 400 });
  }
  const key_value =
    key_type === "pincode"
      ? normalisePincodeKey(key_input)
      : normaliseLocalityKey(key_input);
  if (!key_value) {
    return NextResponse.json({ error: "Empty normalised key." }, { status: 400 });
  }

  const zoneRaw = sp.get("zone");
  let nextZone: "zone1" | "zone2" | "zone3" | "zone4" | null = null;
  if (zoneRaw && zoneRaw !== "clear") {
    if (!isNumberedZone(zoneRaw)) {
      return NextResponse.json({ error: "zone must be zone1..zone4 or clear." }, { status: 400 });
    }
    nextZone = zoneRaw;
  }

  try {
    const preview = await previewRuleChange(supabaseAdmin, {
      keyType: key_type,
      keyValue: key_value,
      nextZone,
    });
    return NextResponse.json({ ...preview, key_value });
  } catch (err) {
    console.error("[admin/zone-rules preview]", (err as Error).message);
    return NextResponse.json({ error: "Failed to compute preview." }, { status: 500 });
  }
}
