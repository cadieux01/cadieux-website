import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export type CustomerAddress = {
  id: string;
  customer_id: string;
  label: "home" | "work" | "other";
  address_line: string;
  city: string;
  state: string | null;
  pincode: string | null;
  is_default: boolean;
  created_at: string;
};

// GET: Fetch all addresses for a customer (requires phone in query)
export async function GET(request: NextRequest) {
  const phone = request.nextUrl.searchParams.get("phone");
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });

  try {
    // Look up customer by phone
    const { data: customers, error: customerError } = await supabase
      .from("customers")
      .select("id")
      .eq("phone", phone)
      .limit(1);

    if (customerError || !customers || customers.length === 0) {
      return NextResponse.json({ addresses: [] });
    }

    const customerId = customers[0].id;

    // Fetch all addresses for this customer, default first
    const { data: addresses, error: addressError } = await supabase
      .from("customer_addresses")
      .select("*")
      .eq("customer_id", customerId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });

    if (addressError) {
      return NextResponse.json(
        { error: "Failed to fetch addresses" },
        { status: 500 },
      );
    }

    return NextResponse.json({ addresses: addresses || [] });
  } catch (error) {
    console.error("GET /api/customer-addresses:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST: Create a new address for a customer
export async function POST(request: NextRequest) {
  const phone = request.nextUrl.searchParams.get("phone");
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });

  try {
    const body = await request.json();
    const { label, address_line, city, state, pincode, is_default } = body;

    // Validate required fields
    if (!label || !address_line || !city) {
      return NextResponse.json(
        { error: "label, address_line, and city are required" },
        { status: 400 },
      );
    }

    // Look up customer by phone
    const { data: customers, error: customerError } = await supabase
      .from("customers")
      .select("id")
      .eq("phone", phone)
      .limit(1);

    if (customerError || !customers || customers.length === 0) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 },
      );
    }

    const customerId = customers[0].id;

    // If is_default is true, unset default on other addresses
    if (is_default) {
      await supabase
        .from("customer_addresses")
        .update({ is_default: false })
        .eq("customer_id", customerId);
    }

    // Insert new address
    const { data: newAddress, error: insertError } = await supabase
      .from("customer_addresses")
      .insert({
        customer_id: customerId,
        label,
        address_line,
        city,
        state: state || null,
        pincode: pincode || null,
        is_default: is_default || false,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: "Failed to create address" },
        { status: 500 },
      );
    }

    return NextResponse.json({ address: newAddress }, { status: 201 });
  } catch (error) {
    console.error("POST /api/customer-addresses:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
