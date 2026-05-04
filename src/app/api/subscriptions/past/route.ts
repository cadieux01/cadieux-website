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

  const phone = normalizePhone(phoneRaw);
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (!customer) return NextResponse.json({ subscriptions: [] });

  const { data: subs, error } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("customer_id", customer.id)
    .in("status", ["completed", "cancelled"])
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[subscriptions past]", error.message);
    return NextResponse.json({ subscriptions: [] });
  }

  return NextResponse.json({ subscriptions: subs ?? [] });
}
