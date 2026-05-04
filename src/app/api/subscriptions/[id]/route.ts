import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizePhone } from "@/lib/phone-cookie";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const phoneRaw = req.nextUrl.searchParams.get("phone") ?? "";
  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: sub, error } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !sub) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Match via customer_id → customers.phone (avoid enumeration on mismatch).
  const { data: cust } = await supabaseAdmin
    .from("customers")
    .select("phone")
    .eq("id", sub.customer_id)
    .maybeSingle();

  if (!cust || normalizePhone(cust.phone) !== phone) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: deliveries } = await supabaseAdmin
    .from("subscription_deliveries")
    .select("*")
    .eq("subscription_id", id)
    .order("week_number", { ascending: true });

  const deliveryIds = (deliveries ?? []).map((d) => d.id);
  const { data: changeRequests } = deliveryIds.length
    ? await supabaseAdmin
        .from("subscription_change_requests")
        .select("*")
        .in("delivery_id", deliveryIds)
        .order("created_at", { ascending: false })
    : { data: [] as Array<Record<string, unknown>> };

  return NextResponse.json({
    subscription: sub,
    deliveries: deliveries ?? [],
    change_requests: changeRequests ?? [],
  });
}
