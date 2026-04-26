import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  PHONE_COOKIE_NAME,
  normalizePhone,
  verifyPhoneCookie,
} from "@/lib/phone-cookie";

// Service role bypasses RLS. Anon key used as fallback (requires permissive RLS policies).
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder"
);

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone");
  if (!phone) return NextResponse.json({ customer: null });

  const { data: customer } = await sb
    .from("customers")
    .select("id, full_name, phone, city")
    .eq("phone", phone)
    .maybeSingle();

  if (!customer) return NextResponse.json({ customer: null });

  // Get all orders
  const { data: orders, error: ordersErr } = await sb
    .from("orders")
    .select("id, total_amount, delivery_address, status, created_at")
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false });

  if (ordersErr) console.error("[orders fetch]", ordersErr.message);

  const lastOrder = orders?.[0];

  return NextResponse.json({
    customer: { ...customer, delivery_address: lastOrder?.delivery_address ?? "" },
    orders: orders ?? [],
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  if (body.action === "save_customer") {
    const { full_name, phone, delivery_address, city } = body;
    if (!phone || !full_name || !delivery_address) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const { data: existing } = await sb
      .from("customers")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    let customerId: string;
    if (existing) {
      await sb.from("customers").update({ full_name, city }).eq("id", existing.id);
      customerId = existing.id;
    } else {
      const { data: newCust, error } = await sb
        .from("customers")
        .insert({ full_name, phone, city })
        .select("id")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      customerId = newCust.id;
    }

    return NextResponse.json({
      customer: { id: customerId, full_name, phone, city, delivery_address },
    });
  }

  if (body.action === "place_order") {
    const { customer_id, delivery_address, total_amount } = body;
    if (!delivery_address || !total_amount) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Server-side OTP enforcement: cookie must be present, valid, unexpired,
    // and its phone must match the customer's stored phone.
    const cookieValue = req.cookies.get(PHONE_COOKIE_NAME)?.value;
    const verified = verifyPhoneCookie(cookieValue);
    if (!verified) {
      return NextResponse.json(
        { error: "Phone verification required." },
        { status: 401 }
      );
    }

    if (!customer_id) {
      return NextResponse.json({ error: "Missing customer." }, { status: 400 });
    }

    const { data: cust } = await sb
      .from("customers")
      .select("id, phone")
      .eq("id", customer_id)
      .maybeSingle();

    if (!cust || normalizePhone(cust.phone) !== verified.phone) {
      return NextResponse.json(
        { error: "Phone verification mismatch." },
        { status: 401 }
      );
    }

    const { data: order, error } = await sb
      .from("orders")
      .insert({ customer_id, total_amount, delivery_address, status: "pending" })
      .select("id")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ order_id: order.id });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
