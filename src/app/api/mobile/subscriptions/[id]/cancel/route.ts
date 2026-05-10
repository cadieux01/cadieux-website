// POST /api/mobile/subscriptions/[id]/cancel
// Sets subscription status to 'cancelled' and cancels any pending deliveries.
// Ownership verified via customer_id FK.
// Fires a WhatsApp notification to the customer.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVerifiedPhone, isValidMobileAppKey, maskPhone } from "@/lib/phone-cookie";
import { toLocal10 } from "@/lib/order-validation";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.cadieux.in";

function fail(status: number, error: string, code?: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

function fireAndForget(
  p: Promise<Response>,
  label: string,
  ctx: { phone: string },
): void {
  p.then(async (res) => {
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string | number;
      };
      console.error(`[mobile/sub cancel] ${label} http_failed`, {
        status: res.status,
        code: data.code,
        error: data.error,
        phone: maskPhone(ctx.phone),
      });
    }
  }).catch((err) => {
    console.error(`[mobile/sub cancel] ${label} threw`, {
      phone: maskPhone(ctx.phone),
      err: String(err),
    });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!process.env.MOBILE_APP_KEY) return fail(500, "Server misconfigured");
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return fail(401, "Unauthorized");
  }
  const verified = getVerifiedPhone(req);
  if (!verified) return fail(401, "Phone not verified");
  const phoneLocal = toLocal10(verified.phone);
  if (phoneLocal.length !== 10) {
    return fail(400, "Verified phone is not in expected format");
  }

  const { data: customer, error: custErr } = await supabaseAdmin
    .from("customers")
    .select("id, full_name")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (custErr) {
    console.error("[mobile/sub cancel] customer lookup:", custErr);
    return fail(500, "Failed to resolve customer");
  }
  if (!customer) return fail(404, "Not found");

  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("id, status, bread_name, product_name")
    .eq("id", params.id)
    .eq("customer_id", customer.id)
    .maybeSingle();
  if (!sub) return fail(404, "Not found");

  if (sub.status === "cancelled" || sub.status === "completed") {
    return NextResponse.json({ ok: true, already: true });
  }

  const now = new Date().toISOString();
  const { error: subErr } = await supabaseAdmin
    .from("subscriptions")
    .update({ status: "cancelled", updated_at: now })
    .eq("id", params.id);
  if (subErr) {
    console.error("[mobile/sub cancel] sub update:", subErr);
    return fail(500, "Failed to cancel subscription");
  }

  // Cancel all non-terminal deliveries.
  await supabaseAdmin
    .from("subscription_deliveries")
    .update({ status: "cancelled", status_updated_at: now })
    .eq("subscription_id", params.id)
    .not("status", "in", "(delivered,cancelled)");

  const productName = sub.product_name || sub.bread_name || "subscription";
  const shortId = String(params.id).slice(0, 8).toUpperCase();
  const waMessage =
    `Hi ${customer.full_name || "there"}! Your Cadieux ${productName} subscription has been cancelled.\n\n` +
    `Subscription ID: ${shortId}\n\n` +
    `If this was a mistake, please contact us at support@cadieux.in.`;
  fireAndForget(
    fetch(`${SITE_URL}/api/send-whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phoneLocal, message: waMessage }),
    }),
    "send-whatsapp-cancel",
    { phone: phoneLocal },
  );

  return NextResponse.json({ ok: true });
}
