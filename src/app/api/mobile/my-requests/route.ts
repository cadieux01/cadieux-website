// GET /api/mobile/my-requests
//
// Mobile-equivalent of GET /api/my-requests. Returns the same aggregator
// payload (order change requests + subscription change requests + payment
// history) for the verified customer.
//
// Auth: X-App-Key header (friction layer — defense in depth; bearer is the
// real gate) + Authorization: Bearer <phone-token> via getVerifiedPhone.
// Owner-scoped by customer_id — never returns another customer's rows.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone, isValidMobileAppKey } from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";
import { loadMyRequests } from "@/lib/my-requests";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export async function GET(req: NextRequest) {
  if (!process.env.MOBILE_APP_KEY) {
    return NextResponse.json(
      { ok: false, error: "Server misconfigured" },
      { status: 500 },
    );
  }
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const verified = getVerifiedPhone(req);
  if (!verified) {
    return NextResponse.json(
      { ok: false, error: "Phone not verified" },
      { status: 401 },
    );
  }

  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) {
    return NextResponse.json(
      { ok: false, error: "Phone format" },
      { status: 400 },
    );
  }

  const { data: customer, error: custErr } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (custErr) {
    console.error("[mobile/my-requests] customer lookup failed:", custErr.message);
    return NextResponse.json(
      { ok: false, error: "Lookup failed" },
      { status: 500 },
    );
  }
  if (!customer) {
    return NextResponse.json({
      ok: true,
      order_change_requests: [],
      subscription_change_requests: [],
      payments: [],
    });
  }

  try {
    const payload = await loadMyRequests(supabaseAdmin, customer.id);
    return NextResponse.json({ ok: true, ...payload });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[mobile/my-requests] load failed:", message);
    return NextResponse.json(
      { ok: false, error: "Failed to load requests" },
      { status: 500 },
    );
  }
}
