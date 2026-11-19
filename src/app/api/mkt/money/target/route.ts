// GET   /api/mkt/money/target  → current weekly break-even target
// PATCH /api/mkt/money/target  → admin writes a new target in paise
//
// Target is stored as an app_config row keyed
// `weekly_breakeven_target_paise`, value as TEXT (matches the house
// convention — every other app_config value is a stringified number
// or 'true/false' etc). Absent = jar renders the "set your weekly
// target" state.
//
// Money comes in as RUPEES from the UI (admin typed `50000`) and is
// stored in paise. The UI divides by 100 at render time.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { mktServerClient } from "@/lib/mkt-auth";

const KEY = "weekly_breakeven_target_paise";

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function requireAdmin() {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const { data: me } = await sb
    .from("profiles")
    .select("role, status")
    .eq("id", userRes.user.id)
    .maybeSingle();
  if (!me || me.role !== "admin" || me.status !== "active") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true };
}

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;

  const svc = service();
  const { data } = await svc
    .from("app_config")
    .select("value, updated_at")
    .eq("key", KEY)
    .maybeSingle();
  const raw = data?.value;
  const n = raw != null ? Number(raw) : NaN;
  const paise = Number.isFinite(n) && n > 0 ? n : null;
  return NextResponse.json({
    target_paise: paise,
    updated_at: data?.updated_at ?? null,
  });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;

  const body = await req.json().catch(() => ({}));
  const raw = Number(
    typeof body?.target_paise === "number" ? body.target_paise : NaN,
  );
  if (!Number.isFinite(raw) || raw <= 0 || !Number.isInteger(raw)) {
    return NextResponse.json(
      { error: "target_paise must be a positive integer (paise)" },
      { status: 400 },
    );
  }

  const svc = service();
  // Upsert on `key` — the app_config table's natural key is `key`,
  // and the shape of its other rows (7 verified in prod) is one row
  // per key. No `id` primary key to worry about.
  const { error } = await svc
    .from("app_config")
    .upsert(
      { key: KEY, value: String(raw), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, target_paise: raw });
}
