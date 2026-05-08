import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone, normalizePhone } from "@/lib/phone-cookie";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const verified = getVerifiedPhone(req);
  if (!verified) {
    return NextResponse.json(
      { error: "Phone verification required." },
      { status: 401 }
    );
  }

  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("id, customer_id, status")
    .eq("id", params.id)
    .maybeSingle();

  if (!sub) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: cust } = await supabaseAdmin
    .from("customers")
    .select("phone")
    .eq("id", sub.customer_id)
    .maybeSingle();
  if (!cust || normalizePhone(cust.phone) !== verified.phone) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (sub.status === "cancelled" || sub.status === "completed") {
    return NextResponse.json({ ok: true, already: true });
  }

  const now = new Date().toISOString();
  const { error: subErr } = await supabaseAdmin
    .from("subscriptions")
    .update({ status: "cancelled", updated_at: now })
    .eq("id", params.id);
  if (subErr) {
    return NextResponse.json({ error: subErr.message }, { status: 500 });
  }

  // Cancel any deliveries that haven't been delivered yet.
  await supabaseAdmin
    .from("subscription_deliveries")
    .update({ status: "cancelled", status_updated_at: now })
    .eq("subscription_id", params.id)
    .not("status", "in", "(delivered,cancelled)");

  return NextResponse.json({ ok: true });
}
