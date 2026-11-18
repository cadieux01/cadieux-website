import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { queueAuditEvent } from "@/lib/audit-log";

// GET — admin detail view. Returns the customer row + every order
// they've placed + every subscription they hold + push token presence,
// plus three CRM panels: a notes timeline (order_notes union over
// order_id / subscription_id), the WhatsApp thread, and the customer's
// reviews.
//
// JOIN KEYS — measured against prod, these are the only ones that
// actually resolve:
//
//   orders.customer_id         → customers.id  (clean, no orphans)
//   subscriptions.customer_id  → customers.id
//   order_notes                → customer via (order_id XOR subscription_id)
//   whatsapp_conversations     → customer_id is 100% NULL in prod, USELESS.
//                                Join on the trailing 10 digits of phone;
//                                customers.phone is bare 10, wa.phone is
//                                91-prefixed 12. A plain customers.phone =
//                                whatsapp_conversations.phone comparison
//                                silently returns 0 rows, no error.
//   whatsapp_messages          → by conversation_id. The CONVERSATION row
//                                holds no message text — only status +
//                                last_*_at stamps. The thread body lives
//                                here.
//   reviews                    → same normalised-phone join, and the
//                                column is `customer_phone` (asking for
//                                `phone` returns 42703 undefined_column).
//
// EVERY PANEL CARRIES ITS OWN *_error. An empty thread and a failed join
// must not look identical on the page — if the reviews table lookup
// fails we want to tell the operator "reviews failed to load", not
// silently paint "no reviews" over a 500.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = params.id;

  const { data: customer, error: cErr } = await supabaseAdmin
    .from("customers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (cErr) {
    console.error("[admin/customers detail]", cErr.message);
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }
  if (!customer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ordersP = supabaseAdmin
    .from("orders")
    .select(
      "id, order_number, total_amount, status, payment_method, payment_status, delivery_address, created_at, latitude, longitude",
    )
    .eq("customer_id", id)
    .order("created_at", { ascending: false });
  const addressesP = supabaseAdmin
    .from("addresses")
    .select("id, label, full_name, line1, area, city, pincode, is_default, created_at, latitude, longitude")
    .eq("customer_id", id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  const subsP = supabaseAdmin
    .from("subscriptions")
    .select(
      "id, product_name, total_weeks, status, payment_status, total_amount, created_at, frequency",
    )
    .eq("customer_id", id)
    // No payment_status filter — see /api/admin/subscriptions. "Every
    // subscription they hold" above was not true while this line was here,
    // and this is the screen you land on after searching a phone number. A
    // customer who rings to ask why her plan has not started must not read
    // as a customer with no plan.
    .order("created_at", { ascending: false });
  // push_tokens may not exist on every environment; on error we
  // degrade silently to an empty list rather than 500 the whole page.
  const tokensP = supabaseAdmin
    .from("push_tokens")
    .select("token, platform, updated_at")
    .eq("customer_id", id)
    .order("updated_at", { ascending: false });

  const [oRes, aRes, sRes, tRes] = await Promise.all([ordersP, addressesP, subsP, tokensP]);

  // ── CRM panels ───────────────────────────────────────────────────────
  //
  // Each panel's failure stays inside the panel — a 500 on reviews must
  // not take the orders table off the page. So we hand the operator a
  // reasonable UI (an inline error on that one card) and 200 the route.

  // Notes timeline — the order_notes table has a mutually-exclusive
  // order_id XOR subscription_id, so we fetch both sides and UNION them
  // newest-first. Bodies are 1..1000 chars, so even a prolific customer
  // fits comfortably in a single response.
  const orderIds = (oRes.data ?? []).map((o) => o.id);
  const subIds = (sRes.data ?? []).map((s) => s.id);

  let notes: Array<{
    id: string;
    kind: string;
    body: string;
    author: string | null;
    created_at: string;
    order_id: string | null;
    subscription_id: string | null;
    customer_visible: boolean | null;
  }> = [];
  let notes_error: string | null = null;
  if (orderIds.length > 0 || subIds.length > 0) {
    const [noByOrder, noBySub] = await Promise.all([
      orderIds.length > 0
        ? supabaseAdmin
            .from("order_notes")
            .select(
              "id, kind, body, author, created_at, order_id, subscription_id, customer_visible",
            )
            .in("order_id", orderIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      subIds.length > 0
        ? supabaseAdmin
            .from("order_notes")
            .select(
              "id, kind, body, author, created_at, order_id, subscription_id, customer_visible",
            )
            .in("subscription_id", subIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (noByOrder.error) notes_error = noByOrder.error.message;
    else if (noBySub.error) notes_error = noBySub.error.message;
    else {
      notes = [...(noByOrder.data ?? []), ...(noBySub.data ?? [])].sort(
        (a, b) => String(b.created_at).localeCompare(String(a.created_at)),
      );
    }
  }
  if (notes_error) {
    console.error("[admin/customers notes]", notes_error);
  }

  // WhatsApp — the trap is that whatsapp_conversations.customer_id is
  // 100% NULL in prod. The usable join is on normalised phone: tail
  // 10 digits of each side. customers.phone is stored bare 10, wa.phone
  // as `91XXXXXXXXXX`, so `ilike '%<tail10>'` on wa matches. We also
  // fetch any messages for the resulting conversation ids — the
  // conversation row carries status + stamps but NO text, which is the
  // second trap.
  const custPhoneDigits = String(customer.phone ?? "").replace(/\D/g, "");
  const custTail10 = custPhoneDigits.slice(-10);
  const whatsapp: {
    conversations: Array<{
      id: string;
      phone: string | null;
      status: string | null;
      last_inbound_at: string | null;
      last_outbound_at: string | null;
      last_message_at: string | null;
      created_at: string | null;
    }>;
    messages: Array<{
      id: string;
      conversation_id: string;
      direction: string | null;
      body: string | null;
      status: string | null;
      ai_generated: boolean | null;
      sent_at: string | null;
      created_at: string;
    }>;
  } = { conversations: [], messages: [] };
  let whatsapp_error: string | null = null;
  if (custTail10.length === 10) {
    const { data: convRows, error: convErr } = await supabaseAdmin
      .from("whatsapp_conversations")
      .select(
        "id, phone, status, last_inbound_at, last_outbound_at, last_message_at, created_at",
      )
      // Trailing-10-digit match. `%XXXXXXXXXX` catches 91-prefixed,
      // +91-prefixed, and bare-10 spellings of the same number — the
      // table has mostly the 91-prefixed shape but legacy rows exist.
      .ilike("phone", `%${custTail10}`)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (convErr) {
      whatsapp_error = convErr.message;
    } else if (convRows && convRows.length > 0) {
      whatsapp.conversations = convRows;
      const convIds = convRows.map((c) => c.id);
      const { data: msgRows, error: msgErr } = await supabaseAdmin
        .from("whatsapp_messages")
        .select(
          "id, conversation_id, direction, body, status, ai_generated, sent_at, created_at",
        )
        .in("conversation_id", convIds)
        .order("created_at", { ascending: true });
      if (msgErr) whatsapp_error = msgErr.message;
      else whatsapp.messages = msgRows ?? [];
    }
  }
  if (whatsapp_error) {
    console.error("[admin/customers whatsapp]", whatsapp_error);
  }

  // Reviews — same trailing-10 match, on customer_phone (NOT phone —
  // asking for `phone` here raises Postgres 42703 undefined_column).
  let reviews: Array<{
    id: string;
    product_slug: string | null;
    author_name: string | null;
    rating: number | null;
    body: string;
    created_at: string;
    is_deleted: boolean | null;
    customer_phone: string | null;
  }> = [];
  let reviews_error: string | null = null;
  if (custTail10.length === 10) {
    const { data, error } = await supabaseAdmin
      .from("reviews")
      .select(
        "id, product_slug, author_name, rating, body, created_at, is_deleted, customer_phone",
      )
      .ilike("customer_phone", `%${custTail10}`)
      .order("created_at", { ascending: false });
    if (error) reviews_error = error.message;
    else reviews = data ?? [];
  }
  if (reviews_error) {
    console.error("[admin/customers reviews]", reviews_error);
  }

  return NextResponse.json({
    customer,
    orders: oRes.data ?? [],
    addresses: aRes.data ?? [],
    subscriptions: sRes.data ?? [],
    push_tokens: tRes.error ? [] : tRes.data ?? [],
    notes,
    notes_error,
    whatsapp,
    whatsapp_error,
    reviews,
    reviews_error,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // EXISTENCE FIRST, AHEAD OF EVERYTHING ELSE. There was no such read at all:
  // the UPDATE below matches no row for an id that does not exist, raises no
  // error, and `maybeSingle()` resolves that to `data: null, error: null` —
  // which went unchecked, so the route answered `{ok: true}` and wrote an
  // audit event whose label and context were the raw UUID (`updated` being
  // null, both fell through to `params.id`). A typo'd id therefore looked
  // exactly like a successful edit and left a permanent audit row pointing at
  // nothing.
  //
  // A failed READ answers 500, not 404: the customer is not known to be gone.
  const { data: before, error: beforeErr } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("id", params.id)
    .maybeSingle();

  if (beforeErr) {
    console.error("[admin/customers PATCH] pre-fetch failed:", beforeErr.message);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};

  if (body.full_name !== undefined) {
    const v = String(body.full_name ?? "").trim();
    update.full_name = v || null;
  }
  if (body.phone !== undefined) {
    const v = String(body.phone ?? "").trim();
    update.phone = v || null;
  }
  if (body.city !== undefined) {
    const v = String(body.city ?? "").trim();
    update.city = v || null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data: updated, error } = await supabaseAdmin
    .from("customers")
    .update(update)
    .eq("id", params.id)
    .select("id, full_name, phone")
    .maybeSingle();

  if (error) {
    console.error("[admin/customers update]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  queueAuditEvent({
    req,
    entity: "customer",
    action: "update",
    targetId: params.id,
    targetLabel: updated?.full_name || updated?.phone || params.id,
    context: `Updated customer ${updated?.full_name ?? params.id}`,
    meta: { fields: Object.keys(update) },
  });

  return NextResponse.json({ ok: true });
}
