// /api/mobile/checkout
//
// Mobile-equivalent of website's /api/checkout (place_order action).
// Differences from web:
//  - Bearer token auth instead of cookie
//  - Server-side price validation against products table (web trusts client)
//  - Order items snapshot persisted to orders.items jsonb (web loses item info)
//  - No Razorpay flow (Phase 3d)
//
// Status starts as 'pending_payment'. Will transition to 'paid' in Phase 3d.
//
// MOBILE_APP_KEY is a friction layer, not a real secret. See phase 3b notes.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone, isValidMobileAppKey, maskPhone } from "@/lib/phone-cookie";
import {
  DELIVERY_FEE_INR,
  reconcilePrices,
  toLocal10,
  validateOrderBodyShape,
  type ProductRow,
} from "@/lib/order-validation";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.cadieux.in";

export async function POST(req: NextRequest) {
  // Fail closed if MOBILE_APP_KEY isn't configured.
  if (!process.env.MOBILE_APP_KEY) {
    return NextResponse.json(
      { ok: false, error: "Server misconfigured" },
      { status: 500 },
    );
  }

  // 1. App-key friction check.
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  // 2. Bearer-token auth.
  const verified = getVerifiedPhone(req);
  if (!verified) {
    return NextResponse.json(
      { ok: false, error: "Phone not verified" },
      { status: 401 },
    );
  }

  // 3. Strip +91 to match the 10-digit local format used in customers.phone.
  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) {
    return NextResponse.json(
      { ok: false, error: "Verified phone is not in expected format" },
      { status: 400 },
    );
  }

  // 4. Validate body shape.
  const raw = await req.json().catch(() => null);
  const shape = validateOrderBodyShape(raw);
  if (!shape.ok) {
    return NextResponse.json(
      { ok: false, error: shape.error, code: shape.code },
      { status: shape.status },
    );
  }
  const { body, fullName, addressString } = shape;

  // 5. Server-side price validation. Re-fetch authoritative product rows.
  const productIds = Array.from(new Set(body.items.map((i) => i.product_id)));
  const { data: productRows, error: productsErr } = await supabaseAdmin
    .from("products")
    .select("id, name, price_inr, is_active")
    .in("id", productIds);

  if (productsErr) {
    console.error("[mobile/checkout] products fetch failed:", productsErr);
    return NextResponse.json(
      { ok: false, error: "Failed to validate cart" },
      { status: 500 },
    );
  }

  const reconciled = reconcilePrices(
    body.items,
    (productRows ?? []) as ProductRow[],
  );
  if (!reconciled.ok) {
    return NextResponse.json(
      { ok: false, error: reconciled.error, code: reconciled.code },
      { status: reconciled.status },
    );
  }

  // 6. Customer upsert by phone.
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (lookupErr) {
    console.error("[mobile/checkout] customer lookup failed:", lookupErr);
    return NextResponse.json(
      { ok: false, error: "Failed to resolve customer" },
      { status: 500 },
    );
  }

  let customerId: string;
  if (existing) {
    const { error: updateErr } = await supabaseAdmin
      .from("customers")
      .update({ full_name: fullName, city: body.delivery_address.city })
      .eq("id", existing.id);
    if (updateErr) {
      console.error("[mobile/checkout] customer update failed:", updateErr);
      return NextResponse.json(
        { ok: false, error: "Failed to update customer" },
        { status: 500 },
      );
    }
    customerId = existing.id;
  } else {
    const { data: newCust, error: insertErr } = await supabaseAdmin
      .from("customers")
      .insert({
        full_name: fullName,
        phone: phoneLocal,
        city: body.delivery_address.city,
      })
      .select("id")
      .single();
    if (insertErr || !newCust) {
      console.error("[mobile/checkout] customer insert failed:", insertErr);
      return NextResponse.json(
        { ok: false, error: "Failed to create customer" },
        { status: 500 },
      );
    }
    customerId = newCust.id;
  }

  // 7. Insert the order with the items snapshot + server-computed total.
  // Total stored in orders.total_amount is inclusive of the flat delivery
  // fee — that's the amount we charge and the amount the order screens
  // display.
  const subtotal = reconciled.total;
  const deliveryFee = DELIVERY_FEE_INR;
  const grandTotal = subtotal + deliveryFee;
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .insert({
      customer_id: customerId,
      total_amount: grandTotal,
      delivery_fee: deliveryFee,
      status: "pending_payment",
      delivery_address: addressString,
      items: reconciled.items,
    })
    .select("id")
    .single();

  if (orderErr || !order) {
    console.error("[mobile/checkout] order insert failed:", orderErr);
    return NextResponse.json(
      { ok: false, error: "Failed to create order" },
      { status: 500 },
    );
  }

  // 8. Fire-and-forget SMS + WhatsApp (mirror website's CheckoutModal calls).
  //    We don't await these — they must not block or fail the order response.
  fireAndForget(
    fetch(`${SITE_URL}/api/send-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "order_placed",
        phone: phoneLocal,
        name: fullName,
        orderId: order.id,
        total: grandTotal,
        address: addressString,
      }),
    }),
    "send-sms",
    { phone: phoneLocal },
  );

  const shortId = String(order.id).slice(0, 8).toUpperCase();
  const waMessage =
    `Hi ${fullName || "there"}! 🍞 Your Cadieux order has been placed successfully!\n\n` +
    `Order ID: ${shortId}\n` +
    `Total: ₹${grandTotal}\n` +
    `Delivery to: ${addressString}\n\n` +
    `We will confirm your order shortly. Thank you for choosing Cadieux!`;
  fireAndForget(
    fetch(`${SITE_URL}/api/send-whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phoneLocal, message: waMessage }),
    }),
    "send-whatsapp",
    { phone: phoneLocal },
  );

  return NextResponse.json({
    ok: true,
    order_id: order.id,
    subtotal_inr: subtotal,
    delivery_fee_inr: deliveryFee,
    total_amount_inr: grandTotal,
    items_summary: reconciled.itemsSummary,
  });
}

/**
 * Detaches a fetch from the response lifecycle. Logs both network failures
 * AND non-2xx responses — Twilio errors come back as 4xx/5xx, which
 * `fetch` does NOT throw on, so the previous .catch-only path silently
 * dropped real delivery failures. Phone is masked to the last 4 digits.
 */
function fireAndForget(
  p: Promise<Response>,
  label: string,
  ctx: { phone: string },
): void {
  p.then(async (res) => {
    if (!res.ok) {
      // Pull only safe fields. Don't log the full response — Twilio echoes
      // back the recipient phone and the message body, both sensitive.
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string | number;
      };
      console.error(
        `[mobile/checkout] ${label} http_failed`,
        {
          status: res.status,
          code: data.code,
          error: data.error,
          phone: maskPhone(ctx.phone),
        },
      );
    }
  }).catch((err) => {
    console.error(
      `[mobile/checkout] ${label} threw`,
      { phone: maskPhone(ctx.phone), err: String(err) },
    );
  });
}
