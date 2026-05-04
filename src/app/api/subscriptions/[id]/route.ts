import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizePhone } from "@/lib/phone-cookie";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

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
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const phone = req.nextUrl.searchParams.get("phone") ?? "";

  const { data: sub, error } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !sub) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!phoneMatches(sub.customer_phone, phone)) {
    // Avoid enumeration — same 404 as a missing row.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: deliveries } = await supabaseAdmin
    .from("subscription_deliveries")
    .select("*")
    .eq("subscription_id", id)
    .order("sequence", { ascending: true });

  const { data: change_requests } = await supabaseAdmin
    .from("subscription_change_requests")
    .select("*")
    .eq("subscription_id", id)
    .order("created_at", { ascending: false });

  return NextResponse.json({
    subscription: sub,
    deliveries: deliveries ?? [],
    change_requests: change_requests ?? [],
  });
}
