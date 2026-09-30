// GET /api/admin/payment-exceptions           — the worklist: unresolved, oldest first
// GET /api/admin/payment-exceptions?resolved=1 — the history: resolved, newest first
//
// Every row here is captured money this system refused to act on because acting
// would have required a guess (see the table comment on public.payment_exceptions
// and /api/razorpay-webhook). The list is the surface that makes those questions
// findable tomorrow morning, after the alert email has scrolled away.
//
// `payload` IS NEVER IN THIS RESPONSE. It is Razorpay's raw event — customer
// contact details and card metadata — and it is why the table has RLS on with
// zero policies. One row's payload is fetched by id, on demand, when a human
// opens it: /api/admin/payment-exceptions/[id]. A list that carried 200 of them
// would put all of it on the wire to render a table nobody reads it from.
//
// UNRESOLVED IS OLDEST-FIRST and that ordering is load-bearing: the customer
// who has been waiting longest must never be the one the LIMIT truncates away.
// (It is also the direction the partial index is built for.)

import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

// Plenty for a table that should normally hold single digits, and a ceiling so
// a table that has gone wrong cannot take the page down with it. The count
// below is unlimited, so the UI can say when it is showing a truncated list.
const PAGE_LIMIT = 200;

// One literal, not a concatenation: PostgREST's types are inferred from the
// select string, and a `string` rather than a literal collapses the row type
// to GenericStringError.
const LIST_COLUMNS =
  "id, reason, razorpay_payment_id, razorpay_order_id, amount_paise, expected_amount_paise, received_at, resolved_at, resolved_note";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolved = req.nextUrl.searchParams.get("resolved") === "1";

  const query = supabaseAdmin
    .from("payment_exceptions")
    .select(LIST_COLUMNS, { count: "exact" })
    .limit(PAGE_LIMIT);

  const { data, error, count } = resolved
    ? await query.not("resolved_at", "is", null).order("resolved_at", { ascending: false })
    : await query.is("resolved_at", null).order("received_at", { ascending: true });

  if (error) {
    console.error("[admin/payment-exceptions list]", error.message);
    return NextResponse.json(
      { error: "Failed to load payment exceptions." },
      { status: 500 },
    );
  }

  const rows = data ?? [];

  // Attach the order this money should have belonged to, where one can be
  // found. The operator's first question is always "which order" — without
  // this they are copying a razorpay id into another tab to find out.
  //
  // DELIBERATELY AN ARRAY, and deliberately not .maybeSingle(): under the
  // OLF/OLW split, admin_create_split_orders stamps THE SAME
  // razorpay_order_id onto BOTH rows (bread + sandwich). That is the same
  // multi-row shape documented as the LOOKUP LANDMINE in the webhook; here it
  // is simply shown, because two matching orders is a fact the resolver needs
  // rather than an error.
  const rzpOrderIds = Array.from(
    new Set(rows.map((r) => r.razorpay_order_id).filter((x): x is string => Boolean(x))),
  );
  const ordersByRzpId = new Map<
    string,
    Array<{ id: string; order_number: string | null; total_amount: number | string | null; payment_status: string | null; status: string | null }>
  >();
  if (rzpOrderIds.length > 0) {
    const { data: orders, error: ordersErr } = await supabaseAdmin
      .from("orders")
      .select("id, order_number, total_amount, payment_status, status, razorpay_order_id")
      .in("razorpay_order_id", rzpOrderIds);
    if (ordersErr) {
      // Context, not the record. The worklist must still render without it —
      // an exception the operator cannot see is worse than one missing a
      // convenience link.
      console.error("[admin/payment-exceptions order hydrate]", ordersErr.message);
    }
    for (const o of orders ?? []) {
      const key = o.razorpay_order_id as string;
      const list = ordersByRzpId.get(key) ?? [];
      list.push({
        id: o.id,
        order_number: o.order_number,
        total_amount: o.total_amount,
        payment_status: o.payment_status,
        status: o.status,
      });
      ordersByRzpId.set(key, list);
    }
  }

  return NextResponse.json({
    exceptions: rows.map((r) => ({
      ...r,
      orders: r.razorpay_order_id ? ordersByRzpId.get(r.razorpay_order_id) ?? [] : [],
    })),
    total: count ?? rows.length,
    truncated: (count ?? 0) > rows.length,
  });
}
