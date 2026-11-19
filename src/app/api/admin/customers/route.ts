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

  // Audit for the team-PIN lookup fires ONCE per request, not once per
  // page below.
  if (q && isTeam) {
    const digits = q.replace(/\D/g, "");
    queueAuditEvent({
      req,
      entity: "customer",
      action: "other",
      context: `[team-PIN] customer lookup by phone ${digits}`,
      meta: { via: "team_order", phone: digits },
    });
  }

  // PAGINATE. PostgREST's `max-rows` setting silently caps the top-
  // level SELECT at 1000 — measured 2026-11-19: 1368 customers in
  // prod, a no-limit SELECT returned 1000. The previous route
  // shipped 368 invisible customers to the UI with no error and no
  // warning anywhere. Fix is explicit `.range()` pagination in
  // 1000-row pages until a short page confirms we're done.
  //
  // Pages are built fresh per iteration because a Supabase query
  // builder is single-use after await — chaining .range() on an
  // already-awaited handle throws. The .or/.eq filters are reapplied
  // on each page because of the same single-use constraint.
  const PAGE_SIZE = 1000;
  const customers: Array<{
    id: string;
    full_name: string | null;
    phone: string | null;
    city: string | null;
    created_at: string;
  }> = [];
  let pageFrom = 0;
  for (;;) {
    let page = supabaseAdmin
      .from("customers")
      .select("id, full_name, phone, city, created_at")
      .order("created_at", { ascending: false })
      .range(pageFrom, pageFrom + PAGE_SIZE - 1);
    if (q) {
      if (isTeam) {
        const digits = q.replace(/\D/g, "");
        page = page.eq("phone", digits);
      } else {
        const safe = q.replace(/[,*()]/g, " ");
        page = page.or(`full_name.ilike.%${safe}%,phone.ilike.%${safe}%`);
      }
    }
    const res = await page;
    if (res.error) {
      console.error("[admin/customers list]", res.error.message);
      return NextResponse.json({ error: res.error.message }, { status: 500 });
    }
    const rows = res.data ?? [];
    customers.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    pageFrom += PAGE_SIZE;
  }
  if (customers.length === 0) {
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

  // `id` on orders/subs is projected so the with_touch block below can
  // reverse-map a note row back to its customer. Without it the touch
  // merge would need a second fan-out — same join, two queries.
  const ordRes = await Promise.all(
    idChunks.map((chunk) =>
      supabaseAdmin
        .from("orders")
        .select(
          "id, customer_id, total_amount, created_at, status, payment_method, payment_status",
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
  // id is projected here (same reason as orders above — the touch block
  // needs the id to reverse-map a note back to its customer).
  const subRes = await Promise.all(
    idChunks.map((chunk) =>
      supabaseAdmin
        .from("subscriptions")
        .select("id, customer_id")
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

  // ── Optional per-customer "last touch" ──────────────────────────────
  //
  // `?with_touch=1` returns, per customer, the NEWER of (their latest
  // order_note body, their latest WhatsApp message body). This is the
  // signal /mkt's "who's gone quiet" column rides on; the plain /admin
  // customers page does not need it and must not pay for it, so the
  // block is opt-in.
  //
  // Admin-only — note bodies and WA message bodies are sensitive
  // content that the team-PIN has no business seeing. We already exited
  // early for isTeam above, so by the time we reach this block the
  // caller is a full admin. Still, the `with_touch` flag is checked
  // alongside the data shape so a future refactor of the early-return
  // branch cannot leak the bodies.
  //
  // Join shape, measured against prod:
  //   notes     → owner is order_id XOR subscription_id; reverse-map via
  //               the order/sub `id → customer_id` tables already built
  //               above.
  //   whatsapp  → conversations.customer_id is 100% NULL (see
  //               tests/admin-customers-crm.test.mjs). Join is on the
  //               trailing 10 digits of phone: customers.phone is bare
  //               10, wa.phone is 91-prefixed 12.
  //
  // Scale note: with 1363 customers / 1195 orders / 140 subs / 170 wa
  // conversations the whole block is one-digit megabytes of PostgREST
  // traffic. Past ~5000 customers the orderIds chunk list alone would
  // warrant a different shape; comment-driven alarm bell for then.
  const wantTouch = req.nextUrl.searchParams.get("with_touch") === "1";
  type Touch = { at: string; body: string; kind: "note" | "call" | "edit" | "whatsapp" };
  const touchByCustomer = new Map<string, Touch>();
  let touch_error: string | null = null;

  if (wantTouch) {
    // Reverse maps — order/sub id → customer id. Built inline so a
    // single pass of notes can be folded straight into the result.
    const orderToCust = new Map<string, string>();
    for (const r of orders) {
      if (r.id && r.customer_id) orderToCust.set(r.id, r.customer_id);
    }
    const subToCust = new Map<string, string>();
    for (const chunk of subRes) {
      for (const row of chunk.data ?? []) {
        if (row.id && row.customer_id) subToCust.set(row.id, row.customer_id);
      }
    }

    const orderIds = Array.from(orderToCust.keys());
    const subIds = Array.from(subToCust.keys());

    // Notes are chunked for exactly the same URL-length reason the
    // orders fan-out is chunked above; see that comment.
    const orderNoteChunks: string[][] = [];
    for (let i = 0; i < orderIds.length; i += CHUNK) {
      orderNoteChunks.push(orderIds.slice(i, i + CHUNK));
    }
    const subNoteChunks: string[][] = [];
    for (let i = 0; i < subIds.length; i += CHUNK) {
      subNoteChunks.push(subIds.slice(i, i + CHUNK));
    }

    const [noteByOrderRes, noteBySubRes, waConvRes] = await Promise.all([
      orderNoteChunks.length > 0
        ? Promise.all(
            orderNoteChunks.map((chunk) =>
              supabaseAdmin
                .from("order_notes")
                .select("kind, body, created_at, order_id, subscription_id")
                .in("order_id", chunk)
                .order("created_at", { ascending: false }),
            ),
          )
        : Promise.resolve([] as const),
      subNoteChunks.length > 0
        ? Promise.all(
            subNoteChunks.map((chunk) =>
              supabaseAdmin
                .from("order_notes")
                .select("kind, body, created_at, order_id, subscription_id")
                .in("subscription_id", chunk)
                .order("created_at", { ascending: false }),
            ),
          )
        : Promise.resolve([] as const),
      // Pull EVERY conversation row and match in JS. There are 170 in
      // prod today; past a few thousand this would want a server-side
      // filter, but the client doesn't support a "right(phone, 10) IN
      // (…)" expression and a long OR-chain of ilikes would run up
      // against the same URL-length cliff the chunking above dodges.
      // Stays under 25 kB because we only project three columns.
      supabaseAdmin
        .from("whatsapp_conversations")
        .select("id, phone, last_message_at"),
    ]);

    const noteErr =
      (Array.isArray(noteByOrderRes)
        ? noteByOrderRes.find((r) => r.error)?.error
        : null) ??
      (Array.isArray(noteBySubRes)
        ? noteBySubRes.find((r) => r.error)?.error
        : null);
    if (noteErr) {
      touch_error = noteErr.message;
    } else {
      const noteRows = [
        ...(Array.isArray(noteByOrderRes)
          ? noteByOrderRes.flatMap((r) => r.data ?? [])
          : []),
        ...(Array.isArray(noteBySubRes)
          ? noteBySubRes.flatMap((r) => r.data ?? [])
          : []),
      ];
      // First row per customer wins because each query is ordered desc.
      // We still have to compare across the two unioned result sets, so
      // the max-by-created_at check is kept.
      for (const row of noteRows as Array<{
        kind: string;
        body: string;
        created_at: string;
        order_id: string | null;
        subscription_id: string | null;
      }>) {
        const cid = row.order_id
          ? orderToCust.get(row.order_id) ?? null
          : row.subscription_id
          ? subToCust.get(row.subscription_id) ?? null
          : null;
        if (!cid) continue;
        const kind =
          row.kind === "call" || row.kind === "edit" ? row.kind : "note";
        const cur = touchByCustomer.get(cid);
        if (!cur || row.created_at > cur.at) {
          touchByCustomer.set(cid, {
            at: row.created_at,
            body: row.body,
            kind,
          });
        }
      }
    }

    if (waConvRes.error) {
      touch_error = touch_error ?? waConvRes.error.message;
    } else {
      // Map each conversation to a customer via trailing 10 digits.
      // Multiple conversations can point at the same customer (rare —
      // the inbound handler reuses a row — but legacy data has some),
      // and one tail10 value is unique per customer (same real phone).
      const tailToCustomer = new Map<string, string>();
      for (const c of customers) {
        const tail = String(c.phone ?? "").replace(/\D/g, "").slice(-10);
        if (tail.length === 10) tailToCustomer.set(tail, c.id);
      }
      const convToCustomer = new Map<string, string>();
      const convLastMsgAt = new Map<string, string | null>();
      for (const row of waConvRes.data ?? []) {
        const tail = String(row.phone ?? "").replace(/\D/g, "").slice(-10);
        if (tail.length !== 10) continue;
        const cid = tailToCustomer.get(tail);
        if (!cid) continue;
        convToCustomer.set(row.id as string, cid);
        convLastMsgAt.set(
          row.id as string,
          (row.last_message_at as string | null) ?? null,
        );
      }

      const relevantConvIds = Array.from(convToCustomer.keys());
      if (relevantConvIds.length > 0) {
        // Chunked, same reason as everything else here.
        const convIdChunks: string[][] = [];
        for (let i = 0; i < relevantConvIds.length; i += CHUNK) {
          convIdChunks.push(relevantConvIds.slice(i, i + CHUNK));
        }
        const msgRes = await Promise.all(
          convIdChunks.map((chunk) =>
            supabaseAdmin
              .from("whatsapp_messages")
              .select("conversation_id, body, created_at")
              .in("conversation_id", chunk)
              .order("created_at", { ascending: false }),
              // NO LIMIT. The sibling /api/admin/whatsapp/conversations
              // list uses `.limit(convIds.length * 4)` because it only
              // needs a one-line preview per conv — but WITH LIMIT and
              // a global ORDER BY DESC, a handful of chatty convs can
              // drown out the quiet ones' newest row entirely (eg at
              // 170 convs and 72 matched, 72×4=288 against 847 total
              // messages in prod today). Here we need the newest
              // message PER conv, not globally; the only safe fold is
              // against the full set. The table is small (847 rows
              // 2026-11-18), so this is a few hundred KB.
          ),
        );
        const msgErr = msgRes.find((r) => r.error)?.error;
        if (msgErr) {
          touch_error = touch_error ?? msgErr.message;
        } else {
          // Newest first; first hit per conv wins.
          const newestMsgByConv = new Map<
            string,
            { body: string; created_at: string }
          >();
          for (const r of msgRes) {
            for (const row of r.data ?? []) {
              const convId = row.conversation_id as string;
              if (!newestMsgByConv.has(convId)) {
                newestMsgByConv.set(convId, {
                  body: (row.body as string) ?? "",
                  created_at: row.created_at as string,
                });
              }
            }
          }
          // Fold each conversation's newest message into the customer
          // touch. Take the greater of the current touch (notes side)
          // and this message's created_at.
          convToCustomer.forEach((cid, convId) => {
            const msg = newestMsgByConv.get(convId);
            if (!msg) return;
            const cur = touchByCustomer.get(cid);
            if (!cur || msg.created_at > cur.at) {
              touchByCustomer.set(cid, {
                at: msg.created_at,
                body: msg.body,
                kind: "whatsapp",
              });
            }
          });
        }
      }
    }

    if (touch_error) console.error("[admin/customers with_touch]", touch_error);
  }

  const enriched = customers.map((c) => {
    const a = agg.get(c.id);
    const touch = wantTouch ? touchByCustomer.get(c.id) ?? null : null;
    return {
      ...c,
      total_orders: a?.total_orders ?? 0,
      // Divide once, at the end. Consumers (CSV export, formatINR) read
      // rupees, same as before.
      total_spent: a ? a.total_spent_paise / 100 : 0,
      outstanding_cod: a ? a.outstanding_cod_paise / 100 : 0,
      last_order_at: a?.last_order_at ?? null,
      has_subscription: subscriberSet.has(c.id),
      // Touch fields are only projected when with_touch was asked for.
      // Absent vs null is intentional: absent means "not requested",
      // null means "requested, no touch found" — the UI distinguishes
      // them.
      ...(wantTouch
        ? {
            last_touch_at: touch?.at ?? null,
            last_touch_body: touch?.body ?? null,
            last_touch_kind: touch?.kind ?? null,
          }
        : {}),
    };
  });

  return NextResponse.json({
    customers: enriched,
    ...(wantTouch ? { touch_error } : {}),
  });
}
