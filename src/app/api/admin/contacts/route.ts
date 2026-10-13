// /api/admin/contacts — record that a contact channel was opened on an order.
//
// POST /api/admin/contacts
//     body: { order_id: uuid, channel: 'call'|'whatsapp'|'sms', author?: string }
//
// There is no GET. The board already receives every order's contact state
// attached to /api/admin/orders (see aggregateContactsFor), and a second
// read path is a second thing to keep in step with the first.
//
// ░░ THIS ENDPOINT IS CALLED AFTER THE ACTION HAS ALREADY HAPPENED. ░░
//
// The dialer, WhatsApp or the SMS app opens FIRST and this POST goes out
// behind it. That is not a preference about latency, it is the only order
// that works: window.open() must be called synchronously inside the click
// handler or the browser treats the popup as unrequested and blocks it
// silently — not delayed, blocked, with no error the operator would see.
// So by the time this route runs, the call is already being placed and
// nothing it returns can prevent anything. It is a recorder, not a gate.
//
// The practical consequence: FAILURES HERE ARE INVISIBLE TO THE OPERATOR
// and must stay cheap. A failed write loses the green, the next person sees
// red, and somebody rings a customer twice. That is the correct way for
// this to break — see the failure-direction note in lib/order-contacts.ts.
//
// Same posture as /api/admin/notes: service-role client, RLS bypassed,
// isAdmin() on the way in, and public.order_contacts has RLS enabled with
// zero policies so nothing else in the world can reach it.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { isContactChannel, type ContactPress } from "@/lib/order-contacts";
import { normalizeAuthor } from "@/lib/order-notes";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT_COLS =
  "order_id, channel, first_contacted_at, last_contacted_at, press_count, last_author";

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  if (!UUID_RE.test(orderId)) {
    return NextResponse.json({ error: "Invalid order_id." }, { status: 400 });
  }
  if (!isContactChannel(body.channel)) {
    return NextResponse.json({ error: "Invalid channel." }, { status: 400 });
  }
  const channel = body.channel;

  // Client-supplied, and that is as good as it gets: isAdmin() is a BOOLEAN
  // gate — it proves the caller is staff and carries no identity at all —
  // so there is no server-side name to prefer over this one. normalizeAuthor
  // trims and caps at 60 chars, which is the same treatment order_notes
  // gives it, so nothing exotic can be parked in a free-text column.
  // Absent → null, which is a normal outcome and not an error: see the note
  // on last_author in the migration.
  const author = normalizeAuthor(body.author);

  // Read the current count so the write can advance it. PostgREST cannot
  // express `press_count = press_count + 1` in an upsert — that needs a SQL
  // function, which is DDL we deliberately did not add for a counter.
  //
  // ░░ SO press_count IS APPROXIMATE UNDER EXACT CONCURRENCY, AND THE ░░
  // ░░ GREEN STATE IS NOT. ░░
  //
  // Two admins pressing the same button in the same instant both read N and
  // both write N+1, so the count can lag by one. What they cannot do is
  // collide on the row: the upsert below resolves on the primary key, so
  // neither press errors and neither loses the green. The count is a
  // secondary signal ("has somebody been ringing this order over and over"),
  // the colour is the feature, and only the colour is guaranteed.
  const { data: existing, error: readErr } = await supabaseAdmin
    .from("order_contacts")
    .select("press_count")
    .eq("order_id", orderId)
    .eq("channel", channel)
    .maybeSingle();
  if (readErr) {
    console.error("[admin/contacts read]", readErr.message);
    return NextResponse.json(
      { error: "Failed to record contact." },
      { status: 500 },
    );
  }

  // first_contacted_at is deliberately ABSENT from this payload. PostgREST
  // builds the ON CONFLICT DO UPDATE set from the keys present, so leaving
  // it out means the column defaults to now() on the first press and is
  // never touched again — which is exactly what "when did this first go
  // green" has to mean. Including it would silently overwrite the original
  // on every subsequent press and quietly destroy the column's meaning.
  const payload = {
    order_id: orderId,
    channel,
    last_contacted_at: new Date().toISOString(),
    press_count: (existing?.press_count ?? 0) + 1,
    last_author: author,
  };

  const { data: saved, error: upsertErr } = await supabaseAdmin
    .from("order_contacts")
    .upsert(payload, { onConflict: "order_id,channel" })
    .select(SELECT_COLS)
    .single();

  if (upsertErr) {
    // 23503 = foreign_key_violation: the order id does not exist. No
    // separate parent lookup before the write — the FK is the authority on
    // whether an order exists, and asking the database twice to learn what
    // it will tell us once is a round trip on a path that already runs
    // behind a live phone call.
    if (upsertErr.code === "23503") {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }
    console.error("[admin/contacts upsert]", upsertErr.message);
    return NextResponse.json(
      { error: "Failed to record contact." },
      { status: 500 },
    );
  }

  const row = saved as {
    channel: string;
    first_contacted_at: string;
    last_contacted_at: string;
    press_count: number;
    last_author: string | null;
  };

  const press: ContactPress = {
    first_contacted_at: row.first_contacted_at,
    last_contacted_at: row.last_contacted_at,
    press_count: row.press_count,
    last_author: row.last_author,
  };

  return NextResponse.json({ channel: row.channel, press });
}
