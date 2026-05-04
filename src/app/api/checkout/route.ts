import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  PHONE_COOKIE_NAME,
  normalizePhone,
  verifyPhoneCookie,
} from "@/lib/phone-cookie";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { orderRateLimit, getClientIP } from "@/lib/ratelimit";

// Server-only admin client. Uses the service role key, which bypasses RLS
// entirely — all writes from this route succeed regardless of table policies.
// SUPABASE_SERVICE_ROLE_KEY must be set in .env.local AND in the Vercel
// Production environment, otherwise this route will throw at request time.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone");
  if (!phone) return NextResponse.json({ customer: null });

  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id, full_name, phone, city")
    .eq("phone", phone)
    .maybeSingle();

  if (!customer) return NextResponse.json({ customer: null });

  // Get all orders
  const { data: orders, error: ordersErr } = await supabaseAdmin
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

    const { data: existing } = await supabaseAdmin
      .from("customers")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    let customerId: string;
    if (existing) {
      const { error: updateErr } = await supabaseAdmin
        .from("customers")
        .update({ full_name, city })
        .eq("id", existing.id);
      if (updateErr) {
        console.error("❌ Customer update failed:", updateErr);
        return NextResponse.json(
          { error: "Failed to update customer", details: updateErr.message },
          { status: 500 }
        );
      }
      customerId = existing.id;
    } else {
      const { data: newCust, error } = await supabaseAdmin
        .from("customers")
        .insert({ full_name, phone, city })
        .select("id")
        .single();
      if (error) {
        console.error("❌ Customer insert failed:", error);
        return NextResponse.json(
          { error: "Failed to create customer", details: error.message },
          { status: 500 }
        );
      }
      customerId = newCust.id;
    }

    return NextResponse.json({
      customer: { id: customerId, full_name, phone, city, delivery_address },
    });
  }

  if (body.action === "place_order") {
    const { customer_id, delivery_address, total_amount, turnstileToken } = body;
    if (!delivery_address || !total_amount) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Distributed rate limit: 5 orders per IP per hour (Upstash Redis).
    const ip = getClientIP(req);
    const { success: rlOk } = await orderRateLimit.limit(ip);
    if (!rlOk) {
      return NextResponse.json(
        { error: "Too many orders. Please wait before placing another order." },
        { status: 429 }
      );
    }

    // Bot gate: every order placement must pass Turnstile.
    const isHuman = await verifyTurnstileToken(String(turnstileToken ?? ""));
    if (!isHuman) {
      return NextResponse.json(
        { error: "Human verification failed. Please try again." },
        { status: 403 }
      );
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

    const { data: cust } = await supabaseAdmin
      .from("customers")
      .select("id, phone")
      .eq("id", customer_id)
      .maybeSingle();

    if (!cust || normalizePhone(cust.phone) !== verified.phone) {
      console.warn("⚠️  place_order phone mismatch", {
        customer_id,
        cust_phone: cust?.phone,
        verified_phone: verified.phone,
      });
      return NextResponse.json(
        { error: "Phone verification mismatch." },
        { status: 401 }
      );
    }

    const { data: order, error } = await supabaseAdmin
      .from("orders")
      .insert({ customer_id, total_amount, delivery_address, status: "pending" })
      .select("id")
      .single();

    if (error) {
      console.error("❌ Order insert failed:", error);
      return NextResponse.json(
        { error: "Failed to create order", details: error.message },
        { status: 500 }
      );
    }

    console.log("✅ Order created:", { order_id: order.id, customer_id, total_amount });
    return NextResponse.json({ order_id: order.id });
  }

  if (body.action === "place_subscription") {
    return NextResponse.json(
      { error: "Use POST /api/subscriptions to create a subscription." },
      { status: 410 }
    );
  }


  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
