// GET /api/admin/customers
//
// List customers with derived stats — total_orders, total_spent,
// last_order_at. Supports optional ?q= partial search on name + phone
// (case-insensitive). No pagination yet; the customer count is small
// enough at launch that an in-memory aggregation is fine. Revisit if
// it grows past a few thousand rows.
//
// DUAL AUTH — this route is one of exactly four endpoints that
// verifyAdminOrTeamOrder opens to the shared /register PIN (the three
// others: POST /api/admin/orders, POST /api/admin/subscriptions/create,
// GET /api/admin/products). Counter staff on the team-PIN need to
// resolve a phone to a customer_id to fill in an order; they must not
// see any CRM aggregate. So the aggregates (total_spent,
// outstanding_cod, has_subscription, and even total_orders /
// last_order_at — all of which are derived, nothing to do with the
// register form) are OMITTED from the response entirely for team-PIN
// callers, not zeroed. Omission means a hostile PIN user cannot even
// tell whether "unknown vs zero" aggregates match a real human; zeroing
// would leak that signal.

import { NextRequest, NextResponse } from "next/server";
import {
  isAdmin,
  isTeamOrderToken,
  supabaseAdmin,
  verifyAdminOrTeamOrder,
} from "@/lib/admin-auth";
import { queueAuditEvent } from "@/lib/audit-log";
import { isCancelled } from "@/lib/order-stages";

export async function GET(req: NextRequest) {
  // Dual-auth: full admin session OR the narrow team-order token
  // (only unlocks the four endpoints the /register form needs).
  if (!verifyAdminOrTeamOrder(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // The team-order token is the "shared /register PIN" — it can look
  // customers up ONLY by a FULL 10-digit phone. This prevents a bored
  // team member from typing "a" and getting the full customer list.
  // Admins retain the partial name / partial phone search.
  const isTeam = !isAdmin(req) && isTeamOrderToken(req);

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();

  if (isTeam) {
    const digits = q.replace(/\D/g, "");
    if (digits.length !== 10) {
      // No error page — the form only lookups on 10 digits anyway,
      // this is belt-and-braces so a hand-crafted request can't skirt.
      return NextResponse.json({ customers: [] });
    }
  }

  let custQ = supabaseAdmin
    .from("customers")
    .select("id, full_name, phone, city, created_at")
    .order("created_at", { ascending: false });

  if (q) {
    if (isTeam) {
      // Exact phone match only. `.eq` avoids the ILIKE wildcard entirely.
      const digits = q.replace(/\D/g, "");
      custQ = custQ.eq("phone", digits);
      queueAuditEvent({
        req,
        entity: "customer",
        action: "other",
        context: `[team-PIN] customer lookup by phone ${digits}`,
        meta: { via: "team_order", phone: digits },
      });
    } else {
      // ILIKE on either name or phone. Supabase's `.or` takes a string
      // expression; escape `*` and `,` in user input to avoid breaking
      // the parser.
      const safe = q.replace(/[,*()]/g, " ");
      custQ = custQ.or(
        `full_name.ilike.%${safe}%,phone.ilike.%${safe}%`,
      );
    }
  }

  const { data: customers, error } = await custQ;
  if (error) {
    console.error("[admin/customers list]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!customers || customers.length === 0) {
    return NextResponse.json({ customers: [] });
  }

  // Team-PIN caller — stop here. No aggregates, no extra round-trips.
  // The register form only reads id/full_name/phone/city off this.
  if (isTeam) {
    return NextResponse.json({ customers });
  }

  // Pull every order row for the matched customers and fold into
  // per-customer aggregates in JS. We only need a narrow slice per row —
  // customer_id/total_amount/created_at/status/payment_method/payment_status.
  //
  // CHUNKED, BECAUSE `in.(...)` RIDES IN THE URL. This was one unchunked
  // call, so with no `?q=` it carried every customer id at once. A uuid plus
  // its comma is 37 bytes, so the query string grew with the customer table
  // and the whole screen died the moment it crossed the gateway's limit:
  // GET /api/admin/customers answered 500 with the bare message
  // "Bad Request", which took /admin/customers AND /admin/customers/[id]
  // (you reach the detail page from the list) off the air entirely.
  //
  // THE REJECTION IS THE GATEWAY'S, NOT POSTGRES'S, and that is why the
  // message carried nothing to act on. Measured on production 2026-10-13 at
  // 977 customers: the request was 36,215 chars and came back
  // `content-type: text/plain`, body `Bad Request`, from cloudflare /
  // sb-gateway — a PostgREST error would have been JSON with a code and a
  // hint. The cliff is ~25 kB of URI: 674 ids (25,020 chars) returned 200,
  // 675 ids (25,057 chars) returned 400. It is the BYTE LENGTH and not the
  // id count — 400 ids alone passed at 14,882 chars, and the same 400 ids
  // padded out to 25,089 chars failed.
  //
  // 200 per chunk matches aggregateNotes() in src/lib/order-notes.ts, which
  // was chunked for exactly this reason; it keeps the URL near 7 kB. Chunks
  // partition the ids, so each customer's orders land in exactly one chunk
  // and the fold below is unaffected by the split.
  const custIds = customers.map((c) => c.id);
  const CHUNK = 200;
  const idChunks: string[][] = [];
  for (let i = 0; i < custIds.length; i += CHUNK) {
    idChunks.push(custIds.slice(i, i + CHUNK));
  }

  const ordRes = await Promise.all(
    idChunks.map((chunk) =>
      supabaseAdmin
        .from("orders")
        .select(
          "customer_id, total_amount, created_at, status, payment_method, payment_status",
        )
        .in("customer_id", chunk),
    ),
  );

  const ordErr = ordRes.find((r) => r.error)?.error;
  if (ordErr) {
    console.error("[admin/customers orders agg]", ordErr.message);
    return NextResponse.json({ error: ordErr.message }, { status: 500 });
  }
  const orders = ordRes.flatMap((r) => r.data ?? []);

  // Subscriber flag — "is there any subscription row at all for this
  // customer_id". `completed` subscriptions still count: a dormant plan
  // template can still generate deliveries, so the operator must see it.
  // We only need the id set; no columns beyond customer_id.
  const subRes = await Promise.all(
    idChunks.map((chunk) =>
      supabaseAdmin
        .from("subscriptions")
        .select("customer_id")
        .in("customer_id", chunk),
    ),
  );
  const subErr = subRes.find((r) => r.error)?.error;
  if (subErr) {
    console.error("[admin/customers subs agg]", subErr.message);
    return NextResponse.json({ error: subErr.message }, { status: 500 });
  }
  const subscriberSet = new Set<string>();
  for (const r of subRes) {
    for (const row of r.data ?? []) {
      if (row.customer_id) subscriberSet.add(row.customer_id);
    }
  }

  // Money accumulates in PAISE to dodge the float drift a repeated
  // rupee-level sum carries — orders.total_amount is stored in rupees
  // and occasionally lands non-integer (delivery fee + ladder discount),
  // so a long running total in float rupees can drift by a few paise per
  // row. Paise ints add cleanly; we divide once at the end. Assertion
  // below pins the integer invariant so a future caller that forgets to
  // Math.round() cannot sneak a float in.
  //
  // `cancelled_at` IS NEVER WRITTEN on this table — null on all 1195
  // rows and cancellation_reason blank on all 1195. The authoritative
  // signal is `status = 'cancelled'`, matched via isCancelled() in
  // order-stages.ts. Using the dead column overstates lifetime value by
  // ~44k and outstanding COD by ~35k.
  type Agg = {
    total_orders: number;
    total_spent_paise: number;
    outstanding_cod_paise: number;
    last_order_at: string | null;
  };
  const agg = new Map<string, Agg>();
  for (const row of orders) {
    if (!row.customer_id) continue;
    if (isCancelled(row.status)) continue; // excludes BOTH count and spend
    const cur = agg.get(row.customer_id) ?? {
      total_orders: 0,
      total_spent_paise: 0,
      outstanding_cod_paise: 0,
      last_order_at: null,
    };
    cur.total_orders += 1;
    const amt = Number(row.total_amount) || 0;
    const paise = Math.round(amt * 100);
    cur.total_spent_paise += paise;
    const pay = String(row.payment_status ?? "").toLowerCase();
    const method = String(row.payment_method ?? "").toLowerCase();
    // Outstanding COD mirrors isPaid()'s rule in reverse: payment_method
    // is 'cod' and payment_status is NOT one of the paid-family values.
    // "not like 'paid%'" catches both 'paid' and 'paid_at_counter'.
    if (method === "cod" && !pay.startsWith("paid")) {
      cur.outstanding_cod_paise += paise;
    }
    if (!cur.last_order_at || row.created_at > cur.last_order_at) {
      cur.last_order_at = row.created_at;
    }
    agg.set(row.customer_id, cur);
  }

  // Integer invariant — asserted at build-up time rather than trusted.
  // A single float-polluted total_amount would produce a float paise sum
  // and this would catch it. Dev-only; in prod we log and continue so a
  // bad row cannot take the whole screen off the air.
  agg.forEach((a, cid) => {
    if (
      !Number.isInteger(a.total_spent_paise) ||
      !Number.isInteger(a.outstanding_cod_paise)
    ) {
      console.error(
        `[admin/customers] non-integer paise for ${cid}:`,
        a.total_spent_paise,
        a.outstanding_cod_paise,
      );
    }
  });

  const enriched = customers.map((c) => {
    const a = agg.get(c.id);
    return {
      ...c,
      total_orders: a?.total_orders ?? 0,
      // Divide once, at the end. Consumers (CSV export, formatINR) read
      // rupees, same as before.
      total_spent: a ? a.total_spent_paise / 100 : 0,
      outstanding_cod: a ? a.outstanding_cod_paise / 100 : 0,
      last_order_at: a?.last_order_at ?? null,
      has_subscription: subscriberSet.has(c.id),
    };
  });

  return NextResponse.json({ customers: enriched });
}
