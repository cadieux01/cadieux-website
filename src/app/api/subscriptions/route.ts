import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone, normalizePhone, maskPhone } from "@/lib/phone-cookie";
import { apiRateLimit, getClientIP } from "@/lib/ratelimit";
import { recordAuditEvent } from "@/lib/audit-log";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Track page polls every 10s and must always see admin's latest writes.
// Disable Next.js fetch/route caching here.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const { success: notRateLimited } = await apiRateLimit.limit(getClientIP(req));
  if (!notRateLimited) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const phoneRaw = req.nextUrl.searchParams.get("phone");
  if (!phoneRaw) return NextResponse.json({ subscriptions: [] });

  const phoneNorm = normalizePhone(phoneRaw);

  // AUTH GATE. Only a caller who has proven control of this phone (signed
  // cookie / Bearer) may read its subscriptions — a bare query param used
  // to return full sub rows (name, address, city, pincode) for anyone.
  const verified = getVerifiedPhone(req);
  if (!verified || normalizePhone(verified.phone) !== phoneNorm) {
    return NextResponse.json({ subscriptions: [] });
  }

  // Match against either normalized or raw stored phone (subscriptions stored
  // whatever the customer typed). Try both common forms.
  const last10 = phoneRaw.replace(/\D/g, "").slice(-10);

  // Active = anything not yet finished. Past page handles completed/cancelled.
  const { data: subs, error } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .or(
      `customer_phone.eq.${phoneRaw},customer_phone.eq.${phoneNorm},customer_phone.like.%${last10}`
    )
    .not("status", "in", "(completed,cancelled)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[subscriptions list]", error.message);
    return NextResponse.json({ subscriptions: [] });
  }

  if (!subs || subs.length === 0) {
    return NextResponse.json({ subscriptions: [] });
  }

  void recordAuditEvent({
    req,
    entity: "subscription",
    action: "other",
    context: `Active subscriptions lookup for ${maskPhone(phoneRaw)}`,
    meta: { phone: maskPhone(phoneRaw), count: subs.length },
  });

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
