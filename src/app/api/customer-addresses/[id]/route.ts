import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// PATCH: Update an address
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = (await params).id;
  const phone = request.nextUrl.searchParams.get("phone");
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });

  try {
    const body = await request.json();
    const { label, address_line, city, state, pincode, is_default } = body;

    // Look up customer by phone (for auth)
    const { data: customers } = await supabase
      .from("customers")
      .select("id")
      .eq("phone", phone)
      .limit(1);

    if (!customers || customers.length === 0) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 },
      );
    }

    const customerId = customers[0].id;

    // Verify the address belongs to this customer
    const { data: existingAddress } = await supabase
      .from("customer_addresses")
      .select("customer_id")
      .eq("id", id)
      .single();

    if (!existingAddress || existingAddress.customer_id !== customerId) {
      return NextResponse.json(
        { error: "Address not found or unauthorized" },
        { status: 404 },
      );
    }

    // If is_default is true, unset default on other addresses
    if (is_default) {
      await supabase
        .from("customer_addresses")
        .update({ is_default: false })
        .eq("customer_id", customerId)
        .neq("id", id);
    }

    // Update address
    const { data: updatedAddress, error: updateError } = await supabase
      .from("customer_addresses")
      .update({
        ...(label && { label }),
        ...(address_line && { address_line }),
        ...(city && { city }),
        ...(state !== undefined && { state: state || null }),
        ...(pincode !== undefined && { pincode: pincode || null }),
        ...(is_default !== undefined && { is_default }),
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to update address" },
        { status: 500 },
      );
    }

    return NextResponse.json({ address: updatedAddress });
  } catch (error) {
    console.error("PATCH /api/customer-addresses/[id]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE: Remove an address
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = (await params).id;
  const phone = request.nextUrl.searchParams.get("phone");
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });

  try {
    // Look up customer by phone (for auth)
    const { data: customers } = await supabase
      .from("customers")
      .select("id")
      .eq("phone", phone)
      .limit(1);

    if (!customers || customers.length === 0) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 },
      );
    }

    const customerId = customers[0].id;

    // Verify the address belongs to this customer
    const { data: existingAddress } = await supabase
      .from("customer_addresses")
      .select("customer_id, is_default")
      .eq("id", id)
      .single();

    if (!existingAddress || existingAddress.customer_id !== customerId) {
      return NextResponse.json(
        { error: "Address not found or unauthorized" },
        { status: 404 },
      );
    }

    // DELETE GUARD — block if this address is bound to an order that is
    // still active (not delivered / cancelled / refunded). orders has
    // `customer_address_id ON DELETE SET NULL` so a hard delete would not
    // fail, but it would orphan the shipping address on live orders and
    // break tracking/receipts. We refuse instead and surface a message
    // the customer can act on.
    const TERMINAL = ["delivered", "cancelled", "refunded"];
    const { data: activeOrders } = await supabase
      .from("orders")
      .select("id, status")
      .eq("customer_address_id", id)
      .not("status", "in", `(${TERMINAL.join(",")})`)
      .limit(1);

    if (activeOrders && activeOrders.length > 0) {
      return NextResponse.json(
        {
          error:
            "This address is tied to an active order. Wait until it's delivered, or cancel it first.",
          code: "address_in_use",
        },
        { status: 409 },
      );
    }

    // Delete the address
    const { error: deleteError } = await supabase
      .from("customer_addresses")
      .delete()
      .eq("id", id);

    if (deleteError) {
      return NextResponse.json(
        { error: "Failed to delete address" },
        { status: 500 },
      );
    }

    // If this was the default, set the oldest address as default
    if (existingAddress.is_default) {
      const { data: addresses } = await supabase
        .from("customer_addresses")
        .select("id")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: true })
        .limit(1);

      if (addresses && addresses.length > 0) {
        await supabase
          .from("customer_addresses")
          .update({ is_default: true })
          .eq("id", addresses[0].id);
      }
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("DELETE /api/customer-addresses/[id]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
