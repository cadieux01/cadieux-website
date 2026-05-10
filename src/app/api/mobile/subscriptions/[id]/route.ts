// GET /api/mobile/subscriptions/[id]
// Returns subscription + all deliveries (sorted by sequence) + change_requests.
// Ownership verified via customer_id FK — no phone fuzzy-match needed.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone, isValidMobileAppKey } from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fail(status: number, error: string, code?: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!process.env.MOBILE_APP_KEY) return fail(500, "Server misconfigured");
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return fail(401, "Unauthorized");
  }
  const verified = getVerifiedPhone(req);
  if (!verified) return fail(401, "Phone not verified");
  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) {
    return fail(400, "Verified phone is not in expected format");
  }

  // Resolve customer by phone so we can verify via customer_id FK.
  const { data: customer, error: custErr } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (custErr) {
    console.error("[mobile/subscriptions/:id GET] customer lookup:", custErr);
    return fail(500, "Failed to resolve customer");
  }
  if (!customer) return fail(404, "Not found");

  // Get subscription — ownership enforced by matching customer_id.
  const { data: sub, error: subErr } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("id", params.id)
    .eq("customer_id", customer.id)
    .maybeSingle();
  if (subErr) {
    console.error("[mobile/subscriptions/:id GET] sub fetch:", subErr);
    return fail(500, "Failed to fetch subscription");
  }
  if (!sub) return fail(404, "Not found");

  // Deliveries + change-requests in parallel for minimal latency.
  const [deliveriesRes, changeRequestsRes] = await Promise.all([
    supabaseAdmin
      .from("subscription_deliveries")
      .select("*")
      .eq("subscription_id", params.id)
      .order("sequence", { ascending: true }),
    supabaseAdmin
      .from("subscription_change_requests")
      .select("*")
      .eq("subscription_id", params.id)
      .order("created_at", { ascending: false }),
  ]);

  return NextResponse.json({
    ok: true,
    subscription: sub,
    deliveries: deliveriesRes.data ?? [],
    change_requests: changeRequestsRes.data ?? [],
  });
}
