import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getVerifiedPhone,
  normalizePhone,
  maskPhone,
  rollPhoneCookieOnWebRequest,
} from "@/lib/phone-cookie";
import { recordAuditEvent } from "@/lib/audit-log";
import { HIDDEN_SUBSCRIPTION_FILTER } from "@/lib/subscription-visibility";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// History endpoint: returns ALL subscriptions for the customer (active,
// completed, cancelled, etc.), most recent first. The page renders status
// badges to differentiate. Live tracking still happens on /api/subscriptions
// which filters to non-finished rows for the active dashboard.

/** Re-issues `cdx_phone_verified` with a fresh expiry on a SUCCESSFUL read.
 *
 *  Same shape as the helper in /api/checkout. Subscription history is a
 *  pure read — a customer looking back over finished plans never touches a
 *  write path, which is exactly the case the old write-only roll missed.
 *  Rolling only on 2xx: a 401 must not resurrect a dead cookie, and a 500
 *  is not evidence of a successful read.
 *
 *  No-op for mobile (bearer, no cookie) and for an already-invalid cookie —
 *  see the helper. Returns the same response for a one-line return site. */
function rolled(req: NextRequest, res: NextResponse): NextResponse {
  rollPhoneCookieOnWebRequest(req, res);
  return res;
}

export async function GET(req: NextRequest) {
  // NO route-level rate limit here, deliberately. middleware.ts matches
  // `/api/:path*` and already applies apiRateLimit to this request on the same
  // IP key and the same bucket, so a call here was the same control run twice:
  // two Redis round-trips and two tokens off a 30/min budget. See the RUN THIS
  // ONCE note on apiRateLimit in lib/ratelimit.ts before re-adding it.

  const phoneRaw = req.nextUrl.searchParams.get("phone");
  if (!phoneRaw) return NextResponse.json({ subscriptions: [] });

  const phoneNorm = normalizePhone(phoneRaw);

  // AUTH GATE. Same reasoning as /api/subscriptions — proof of phone
  // control required before returning any subscription history, and 401
  // rather than an empty 200 so an expired session is distinguishable
  // from a customer who has genuinely never subscribed.
  const verified = getVerifiedPhone(req);
  if (!verified || normalizePhone(verified.phone) !== phoneNorm) {
    return NextResponse.json(
      { subscriptions: [], reason: "phone_not_verified" },
      { status: 401 },
    );
  }

  const last10 = phoneRaw.replace(/\D/g, "").slice(-10);

  // Match by either FK customer_id OR direct customer_phone — covers legacy
  // rows from the old wizard that may not have set customer_id.
  const { data: customer } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("phone", phoneNorm)
    .maybeSingle();

  const orParts = [
    `customer_phone.eq.${phoneRaw}`,
    `customer_phone.eq.${phoneNorm}`,
    `customer_phone.like.%${last10}`,
  ];
  if (customer) orParts.push(`customer_id.eq.${customer.id}`);

  const { data: subs, error } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .or(orParts.join(","))
    .not("payment_status", "in", HIDDEN_SUBSCRIPTION_FILTER)
    .order("created_at", { ascending: false });

  // See /api/subscriptions — a query failure gets a 500, not an empty list
  // dressed up as a complete answer.
  if (error) {
    console.error("[subscriptions past]", error.message);
    return NextResponse.json(
      { subscriptions: [], reason: "query_failed" },
      { status: 500 },
    );
  }

  if (!subs || subs.length === 0) {
    return rolled(req, NextResponse.json({ subscriptions: [] }));
  }

  void recordAuditEvent({
    req,
    entity: "subscription",
    action: "other",
    context: `Subscription history lookup for ${maskPhone(phoneRaw)}`,
    meta: { phone: maskPhone(phoneRaw), count: subs.length },
  });

  // Annotate each sub with its scheduled-delivery count for the row UI.
  const ids = subs.map((s) => s.id);
  const { data: deliveries } = await supabaseAdmin
    .from("subscription_deliveries")
    .select("subscription_id")
    .in("subscription_id", ids);

  const countBySub = new Map<string, number>();
  for (const d of deliveries ?? []) {
    countBySub.set(d.subscription_id, (countBySub.get(d.subscription_id) ?? 0) + 1);
  }

  return rolled(
    req,
    NextResponse.json({
      subscriptions: subs.map((s) => ({
        ...s,
        deliveries_count: countBySub.get(s.id) ?? s.total_weeks ?? 0,
      })),
    }),
  );
}
