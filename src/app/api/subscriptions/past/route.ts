import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizePhone } from "@/lib/phone-cookie";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// History endpoint: returns ALL subscriptions for the customer (active,
// completed, cancelled, etc.), most recent first. The page renders status
// badges to differentiate. Live tracking still happens on /api/subscriptions
// which filters to non-finished rows for the active dashboard.
export async function GET(req: NextRequest) {
  const phoneRaw = req.nextUrl.searchParams.get("phone");
  if (!phoneRaw) return NextResponse.json({ subscriptions: [] });

  const phoneNorm = normalizePhone(phoneRaw);
  const last10 = phoneRaw.replace(/\D/g, "").slice(-10);

  // Match by either FK customer_id OR direct customer_phone — covers legacy
  // rows from the old wizard that may not have set customer_id.
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneNorm)
    .maybeSingle();

  const orParts = [
    `customer_phone.eq.${phoneRaw}`,
    `customer_phone.eq.${phoneNorm}`,
    `customer_phone.like.%${last10}`,
  ];
  if (customer) orParts.push(`customer_id.eq.${customer.id}`);

  const { data: subs, error } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .or(orParts.join(","))
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[subscriptions past]", error.message);
    return NextResponse.json({ subscriptions: [] });
  }

  if (!subs || subs.length === 0) {
    return NextResponse.json({ subscriptions: [] });
  }

  // Annotate each sub with its scheduled-delivery count for the row UI.
  const ids = subs.map((s) => s.id);
  const { data: deliveries } = await supabaseAdmin
    .from("subscription_deliveries")
    .select("subscription_id")
    .in("subscription_id", ids);

  const countBySub = new Map<string, number>();
  for (const d of deliveries ?? []) {
    countBySub.set(d.subscription_id, (countBySub.get(d.subscription_id) ?? 0) + 1);
  }

  return NextResponse.json({
    subscriptions: subs.map((s) => ({
      ...s,
      deliveries_count: countBySub.get(s.id) ?? s.total_weeks ?? 0,
    })),
  });
}
