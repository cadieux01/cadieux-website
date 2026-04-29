import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizePhone } from "@/lib/phone-cookie";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function GET(req: NextRequest) {
  const phoneRaw = req.nextUrl.searchParams.get("phone");
  if (!phoneRaw) return NextResponse.json({ subscriptions: [] });

  const phoneNorm = normalizePhone(phoneRaw);
  // Match against either normalized or raw stored phone (subscriptions stored
  // whatever the customer typed). Try both common forms.
  const last10 = phoneRaw.replace(/\D/g, "").slice(-10);

  const { data: subs, error } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .or(
      `customer_phone.eq.${phoneRaw},customer_phone.eq.${phoneNorm},customer_phone.like.%${last10}`
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[subscriptions list]", error.message);
    return NextResponse.json({ subscriptions: [] });
  }

  if (!subs || subs.length === 0) {
    return NextResponse.json({ subscriptions: [] });
  }

  const ids = subs.map((s) => s.id);
  const { data: deliveries } = await supabaseAdmin
    .from("subscription_deliveries")
    .select("subscription_id, delivery_date, status")
    .in("subscription_id", ids)
    .order("delivery_date", { ascending: true });

  const nextBySub = new Map<string, string | null>();
  for (const d of deliveries ?? []) {
    if (d.status === "delivered") continue;
    if (!nextBySub.has(d.subscription_id)) {
      nextBySub.set(d.subscription_id, d.delivery_date);
    }
  }

  return NextResponse.json({
    subscriptions: subs.map((s) => ({
      ...s,
      next_delivery_date: nextBySub.get(s.id) ?? null,
    })),
  });
}
