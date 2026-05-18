// Public lookup for the cart banner. Returns whether a customer (by
// phone) has an active (pending or recently-serviceable) delivery
// request so we can show the amber/green status strip on /cart without
// re-prompting them.

import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/admin-auth";
import { apiRateLimit, getClientIP } from "@/lib/ratelimit";

type Row = {
  id: string;
  status: string;
  pincode: string;
  area_name: string | null;
  created_at: string;
  resolved_at: string | null;
};

function normalizePhoneDigits(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return null;
}

export async function GET(req: NextRequest) {
  const { success: ok } = await apiRateLimit.limit(getClientIP(req));
  if (!ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429 },
    );
  }

  const phone = normalizePhoneDigits(req.nextUrl.searchParams.get("phone"));
  if (!phone) {
    return NextResponse.json(
      { request: null, error: "Invalid phone" },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("delivery_requests")
    .select("id, status, pincode, area_name, created_at, resolved_at")
    .eq("phone", phone)
    .in("status", ["pending", "serviceable"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn("[delivery-requests by-phone] lookup failed:", error.message);
    return NextResponse.json({ request: null });
  }
  const row = (data ?? [])[0] as Row | undefined;
  return NextResponse.json({ request: row ?? null });
}
