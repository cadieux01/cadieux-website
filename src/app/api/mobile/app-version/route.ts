// /api/mobile/app-version
// Returns the minimum Android versionCode the app must be on to run, plus
// an optional update message. Read from public.app_config (RLS = public
// select). The mobile app calls this on launch; if its installed
// versionCode < min, it shows a blocking "Update Required" screen.
//
// Auth: X-App-Key (matches MOBILE_APP_KEY env var), same as other
// /api/mobile/* routes. No phone bearer.
//
// Caching: response cache 60s — version-gate config changes are rare and
// the app fail-opens on any fetch error, so a small staleness window is
// fine.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { isValidMobileAppKey } from "@/lib/phone-cookie";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

type AppVersionResponse = {
  min_android_version_code: number;
  latest_android_version_code: number | null;
  update_message: string | null;
};

function toIntOrNull(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  if (!process.env.MOBILE_APP_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 500 },
    );
  }
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("app_config")
      .select("key, value")
      .in("key", [
        "min_android_version_code",
        "latest_android_version_code",
        "update_message",
      ]);

    if (error) {
      console.error("[mobile/app-version GET]", error.message);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }

    const byKey: Record<string, string> = {};
    for (const row of data ?? []) byKey[row.key] = row.value;

    // Floor min at 1 if missing/malformed.
    const min = toIntOrNull(byKey["min_android_version_code"]) ?? 1;
    const latest = toIntOrNull(byKey["latest_android_version_code"]);
    const message = byKey["update_message"] ?? null;

    const body: AppVersionResponse = {
      min_android_version_code: min,
      latest_android_version_code: latest,
      update_message: message,
    };
    return NextResponse.json(body, {
      headers: {
        // Short edge cache; app also has its own fetch behaviour.
        "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=60",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    console.error("[mobile/app-version GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
