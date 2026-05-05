import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizePhone } from "@/lib/phone-cookie";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Detail page polls every 10s; never cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

function phoneMatches(stored: string | null | undefined, queried: string): boolean {
  if (!stored) return false;
  if (stored === queried) return true;
  if (normalizePhone(stored) === normalizePhone(queried)) return true;
  const a = stored.replace(/\D/g, "").slice(-10);
  const b = queried.replace(/\D/g, "").slice(-10);
  return a.length === 10 && a === b;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { deliveryId: string } }
) {
  const { deliveryId } = params;
  const phone = req.nextUrl.searchParams.get("phone") ?? "";
  if (!phone) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: delivery, error: dErr } = await supabaseAdmin
    .from("subscription_deliveries")
    .select("*")
    .eq("id", deliveryId)
    .maybeSingle();
  if (dErr || !delivery) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("id", delivery.subscription_id)
    .maybeSingle();
  if (!sub) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!phoneMatches(sub.customer_phone, phone)) {
    // Avoid enumeration — same 404 as a missing row.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: change_requests } = await supabaseAdmin
    .from("subscription_change_requests")
    .select("*")
    .eq("delivery_id", deliveryId)
    .order("created_at", { ascending: false });

  return NextResponse.json({
    delivery,
    subscription: sub,
    change_requests: change_requests ?? [],
  });
}
