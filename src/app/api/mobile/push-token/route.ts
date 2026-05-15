// POST /api/mobile/push-token
//
// Mobile-only. Saves (upserts) the verified customer's Expo push token.
// Called on every app launch — tokens can rotate, so we always overwrite
// the stored value. One token per customer.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getVerifiedPhone,
  isValidMobileAppKey,
} from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";
import { isExpoPushToken } from "@/lib/push";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function fail(status: number, error: string, code?: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

export async function POST(req: NextRequest) {
  if (!process.env.MOBILE_APP_KEY) return fail(500, "Server misconfigured");
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return fail(401, "Unauthorized");
  }

  const verified = getVerifiedPhone(req);
  if (!verified) return fail(401, "Phone not verified");
  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) return fail(400, "Phone format");

  const raw = await req.json().catch(() => null);
  const token =
    raw && typeof raw === "object"
      ? (raw as { token?: unknown }).token
      : null;
  if (!isExpoPushToken(token)) {
    return fail(400, "Invalid push token", "invalid_token");
  }

  // Resolve customer row by phone. The customer row is created at OTP
  // verification time and again at checkout, so a verified caller always
  // has one. If somehow missing, surface a 404 so the app can retry
  // after the next checkout/profile call.
  const { data: customer, error: lookupErr } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (lookupErr) {
    console.error("[push-token] customer lookup failed:", lookupErr.message);
    return fail(500, "Lookup failed");
  }
  if (!customer) {
    return fail(404, "Customer not found", "no_customer");
  }

  const { error: updateErr } = await supabaseAdmin
    .from("customers")
    .update({ push_token: token })
    .eq("id", customer.id);
  if (updateErr) {
    console.error("[push-token] update failed:", updateErr.message);
    return fail(500, "Failed to save push token");
  }

  return NextResponse.json({ ok: true });
}
