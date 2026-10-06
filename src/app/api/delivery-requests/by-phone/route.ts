// Public lookup for the cart banner. Returns whether a customer (by
// phone) has an active (pending or recently-serviceable) delivery
// request so we can show the amber/green status strip on /cart without
// re-prompting them.

import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/admin-auth";
import { allowedOrFailOpen, apiRateLimit, getClientIP } from "@/lib/ratelimit";

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
  // Fail open, deadlined — reads delivery_requests out of our own Postgres,
  // nothing billed and nothing written. This sits on /cart, so a stall here
  // is a stall in front of buying.
  const ok = await allowedOrFailOpen(apiRateLimit, getClientIP(req));
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
  // LOGGED, NOT FIXED: this answers a FAILED QUERY with 200 { request: null },
  // which the /cart banner cannot tell apart from "this customer has no open
  // request" — so a Postgres error silently re-prompts a customer who already
  // asked us to deliver to their area. Same bug class as the one removed from
  // /api/checkout and /api/subscriptions (an empty result standing in for an
  // error). Left alone deliberately: it is outside the scope of the branch
  // that found it, and changing it means touching the /cart banner's states
  // too. Fix it with that UI, not on its own.
  if (error) {
    console.warn("[delivery-requests by-phone] lookup failed:", error.message);
    return NextResponse.json({ request: null });
  }
  const row = (data ?? [])[0] as Row | undefined;
  return NextResponse.json({ request: row ?? null });
}
