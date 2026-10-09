import { NextRequest, NextResponse } from "next/server";
import {
  isAdmin,
  isTeamOrderToken,
  supabaseAdmin,
  verifyAdminOrTeamOrder,
} from "@/lib/admin-auth";
import {
  buildRepeatIndex,
  computeRetention,
  type HistoryOrder,
} from "@/lib/customer-history";
import { matchesAdminQuery } from "@/lib/admin-search";
import { aggregateNotesFor } from "@/lib/order-notes";
import { computeOrderState } from "@/lib/order-state";
import {
  orderInsertColumns,
  prepareOneTimeOrder,
} from "@/lib/order-checkout";
import { recordAuditEvent } from "@/lib/audit-log";
import { internalJsonHeaders } from "@/lib/internal-secret";
import { buildOrderPlacedWhatsApp } from "@/lib/order-messages";
import { maskPhone } from "@/lib/phone-cookie";
import { formatOrderNumber } from "@/lib/order-number";
import { queueOrderNotification } from "@/lib/order-notification";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://www.cadieux.in";

// The full row projection the board renders from. ~1.2 kB of JSON per row,
// which is why the default response is bounded: 715 rows was 888 kB on the
// wire and ~35,000 React elements to rebuild.
//
// distance_km is here for /admin/deliveries' driving-order sort, which
// falls back to it for the ~2 in 3 orders that have no GPS pin. One
// float per row; see partner-deliveries.ts for why only post-cutover
// rows are usable.
// status_updated_at + paid_at + cod_settled_method are projected for the
// COD settlement control: it must SHOW the paid_at it is about to write
// (for a delivered order that is status_updated_at) before saving.
const FULL_SELECT =
  "id, order_number, public_ref, customer_id, total_amount, status, payment_method, payment_status, delivery_address, delivery_date, delivery_slot, items, created_at, status_updated_at, paid_at, cod_settled_method, latitude, longitude, distance_km, fulfillment_type, pickup_location_id, pickup_ready_at, picked_up_at, is_preorder, scheduled_delivery_date_by, scheduled_delivery_date_at, order_kind, customers(id, full_name, phone, city)";

// The LEAN projection: every column needed to (a) fold the repeat-customer
// index and the retention panel over the whole table, (b) answer the search
// box, and (c) count the Bread / Sandwiches tabs. ~70 bytes a row, and it
// NEVER crosses the wire — it exists only so that bounding the full
// projection cannot change an answer.
const LEAN_SELECT =
  "id, status, payment_status, created_at, total_amount, order_number, public_ref, order_kind, customers(full_name, phone)";

/** Rows returned by default, newest first. */
const DEFAULT_LIMIT = 250;
/** Hard ceiling on ?limit= so a hand-typed URL cannot ask for the world. */
const MAX_LIMIT = 2000;
/**
 * Ceiling on rows pulled in from OUTSIDE the default window (live work of
 * any age, plus search hits). Keeps the `id=in.(…)` URL well under the
 * PostgREST request-line limit. Exceeding it sets `truncated`.
 */
const MAX_OUT_OF_WINDOW = 200;

/** Only the columns this route reads off a FULL_SELECT row by name; the rest
 *  ride through the index signature straight into the response. */
type FullOrderRow = {
  id: string;
  created_at: string;
  status?: string | null;
  payment_status?: string | null;
  pickup_location_id?: string | null;
  [key: string]: unknown;
};

type LeanOrder = {
  id: string;
  status: string | null;
  payment_status: string | null;
  created_at: string;
  total_amount: number | string | null;
  order_number: string | null;
  public_ref: string | null;
  order_kind: string | null;
  customers: { full_name: string | null; phone: string | null } | null;
};

/** created_at desc, id desc as a stable tie-break. Both the lean query and
 *  the bounded full query order this way, so the window the lean pass
 *  computes is byte-for-byte the window the full pass returns. */
function newestFirst(a: FullOrderRow, b: FullOrderRow) {
  return b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
}

/**
 * GET /api/admin/orders
 *
 *   ?all=1     — every order, unbounded. Used by /admin/orders/print,
 *                /admin/orders/run-sheet and /admin/deliveries, which each
 *                slice the whole table client-side, and by the board's own
 *                "Load all" control.
 *   ?limit=N   — size of the default window (default 250, max 2000).
 *   ?q=…       — SERVER-SIDE SEARCH. Without it, bounding the query would
 *                silently stop the board's client-side search box from
 *                finding anything older than the window. The match is run
 *                with matchesAdminQuery — the very function the board
 *                filters with — over the lean index, so the server and the
 *                client cannot disagree about what "matches".
 *
 * The default response is the union of three sets, so that nothing the
 * operator must act on can fall out of the window:
 *   1. the newest `limit` orders,
 *   2. every order still live (computed_state active | pending) at any age,
 *   3. every order matching `q` at any age.
 */
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const wantAll = params.get("all") === "1";
  const q = (params.get("q") ?? "").trim();
  const limitRaw = Number(params.get("limit"));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.trunc(limitRaw), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const nowMs = Date.now();

  // WAVE 1 — the lean full-table read, in parallel with the hydrated rows.
  //
  // `lean` is what keeps repeat_seq, customer_order_count,
  // customer_first_order_at and the whole retention panel exact: they are
  // folded over EVERY order, not over the window.
  //
  // The hydrated read alongside it does NOT depend on `lean`: with ?all=1
  // it is the same unbounded set, and by default it is just "newest
  // `limit`, same ORDER BY", which the window is BY DEFINITION the head of.
  // Only the out-of-window top-up needs ids computed from `lean`, and that
  // is wave 2. Awaiting these in sequence cost a whole Mumbai→Tokyo round
  // trip for nothing. Both ORDER BY clauses are identical so the head of
  // one is the head of the other.
  const hydratedQuery = wantAll
    ? supabaseAdmin
        .from("orders")
        .select(FULL_SELECT)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
    : supabaseAdmin
        .from("orders")
        .select(FULL_SELECT)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);

  const [leanRes, hydratedRes] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select(LEAN_SELECT)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
    hydratedQuery,
  ]);

  if (leanRes.error) {
    console.error("[admin/orders list] lean", leanRes.error.message);
    return NextResponse.json({ error: leanRes.error.message }, { status: 500 });
  }
  if (hydratedRes.error) {
    console.error("[admin/orders list]", hydratedRes.error.message);
    return NextResponse.json(
      { error: hydratedRes.error.message },
      { status: 500 },
    );
  }
  const lean = (leanRes.data ?? []) as unknown as LeanOrder[];
  const hydrated = (hydratedRes.data ?? []) as unknown as FullOrderRow[];

  // WAVE 2 — top up the window with anything outside it the operator must
  // still be able to see.
  let rows: FullOrderRow[];
  let truncated = false;

  if (wantAll) {
    rows = hydrated;
  } else {
    const inWindow = new Set(lean.slice(0, limit).map((r) => r.id));
    const outside: string[] = [];
    for (const r of lean) {
      if (inWindow.has(r.id)) continue;
      const state = computeOrderState(r, nowMs);
      const live = state === "active" || state === "pending";
      const hit =
        q.length > 0 &&
        matchesAdminQuery(q, [
          r.customers?.full_name,
          r.customers?.phone,
          r.public_ref,
          r.order_number,
        ]);
      if (live || hit) outside.push(r.id);
    }
    truncated = outside.length > MAX_OUT_OF_WINDOW;
    // `lean` is newest-first, so the slice keeps the most recent hits.
    const wanted = outside.slice(0, MAX_OUT_OF_WINDOW);

    // Skipped entirely when nothing is outside the window — which is the
    // common case on a quiet day, and makes the whole GET two waves.
    let outsideRows: FullOrderRow[] = [];
    if (wanted.length > 0) {
      const { data, error } = await supabaseAdmin
        .from("orders")
        .select(FULL_SELECT)
        .in("id", wanted);
      if (error) {
        console.error("[admin/orders list] outside", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      outsideRows = (data ?? []) as unknown as FullOrderRow[];
    }
    const merged = new Map<string, FullOrderRow>();
    for (const r of [...hydrated, ...outsideRows]) {
      merged.set(r.id, r);
    }
    rows = Array.from(merged.values()).sort(newestFirst);
  }

  // WAVE 3 — the two side-fetches, together. Both read only `rows` and
  // neither reads the other's result, so awaiting them in sequence was one
  // round trip of pure latency. On a board with no pickup orders the first
  // is not a query at all.
  //
  // pickup_locations is a manual join (rather than a PostgREST embed)
  // because there's no FK between orders.pickup_location_id and
  // pickup_locations.id yet.
  //
  // Note aggregates come back in one round trip so the board can render the
  // note icon (with count) and the last-call chip without a per-row lookup.
  // Failure is swallowed inside aggregateNotesFor and returns an empty map,
  // so the list still loads if the notes table is unreachable.
  const pickupIds = Array.from(
    new Set(
      rows
        .map((r) => r.pickup_location_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );
  const orderIds = rows.map((r) => r.id).filter((v) => v.length > 0);

  const [pickupRes, noteAgg] = await Promise.all([
    pickupIds.length > 0
      ? supabaseAdmin
          .from("pickup_locations")
          .select("id, name, area, address")
          .in("id", pickupIds)
      : Promise.resolve({ data: [], error: null }),
    aggregateNotesFor(supabaseAdmin, "order", orderIds),
  ]);

  const pickupById: Record<string, { id: string; name: string; area: string; address: string }> = {};
  for (const l of pickupRes.data ?? []) {
    pickupById[l.id] = l;
  }

  // Repeat-customer history + the retention panel, folded over the LEAN
  // pass — keyed on customers.phone, cancelled orders excluded.
  //
  // IT MUST BE `lean`, NEVER `rows`. These are whole-table facts: an
  // order's position in its customer's history, and the retention
  // percentages. Folding them over the bounded `rows` would quietly
  // restate a 4th order as a 1st and recompute the retention panel off a
  // slice — wrong numbers with no error anywhere.
  const repeatIndex = buildRepeatIndex(lean as unknown as HistoryOrder[]);
  const retention = computeRetention(lean as unknown as HistoryOrder[]);

  // Attach computed_state on every row so admin filters / badges never need
  // to duplicate the classifier. See src/lib/order-state.ts (mirrors the
  // WhatsApp bot's classifyOrder — the single source of truth for "expired").
  const enriched = rows.map((r) => {
    const agg = noteAgg.get(r.id);
    const rep = repeatIndex.get(r.id);
    return {
      ...r,
      pickup_location: r.pickup_location_id ? pickupById[r.pickup_location_id] ?? null : null,
      computed_state: computeOrderState(r, nowMs),
      note_count: agg?.note_count ?? 0,
      last_call_note: agg?.last_call_note ?? null,
      last_note: agg?.last_note ?? null,
      repeat_seq: rep?.repeat_seq ?? null,
      customer_order_count: rep?.customer_order_count ?? null,
      customer_first_order_at: rep?.customer_first_order_at ?? null,
    };
  });

  // The Bread / Sandwiches tab badges. Also folded over `lean`, and for the
  // same reason as the history above: those badges are the operator's answer
  // to "how many sandwich orders are there", and counting the bounded `rows`
  // would print a number that shrinks as the window does. "Bread 267" when
  // 715 exist reads as orders having vanished.
  // order_kind is NULL on every pre-launch row and defaults to bread.
  const kindCounts = { bread: 0, sandwich: 0 } as Record<string, number>;
  for (const r of lean) {
    const k = r.order_kind ?? "bread";
    if (k in kindCounts) kindCounts[k] += 1;
  }

  // total_orders / truncated make the bound VISIBLE. A board that silently
  // shows a slice of the table is the failure mode this endpoint used to
  // avoid by returning everything; now the client is told, and offers a
  // "Load all".
  return NextResponse.json({
    orders: enriched,
    retention,
    total_orders: lean.length,
    kind_counts: kindCounts,
    truncated: truncated || enriched.length < lean.length,
  });
}

// POST /api/admin/orders — manual order entry ("Register New Order").
//
// Admin-only. Reuses prepareOneTimeOrder + orderInsertColumns so the row
// is byte-identical to a real customer-placed order (auto-refund gate,
// tracking page, mobile /api/mobile/orders, WhatsApp bot classifier and
// the admin list/print pages all keep working unchanged).
//
// Customer linking: we upsert public.customers by 10-digit local phone
// (the same key mobile/checkout uses). If a row already exists we NEVER
// overwrite full_name/city — only fill them when the current value is
// null/blank, so an existing customer's saved profile is safe.
//
// Serviceability override (`serviceabilityOverride: true`): skips ONLY
// the pincode + out-of-range gates in prepareOneTimeOrder, and prices an
// out-of-range or unmeasurable address at the TOP delivery band rather
// than refusing it. Every other gate — price, slot shape, item shape,
// phone-match — stays hard. See PrepareOptions.skipServiceability in
// src/lib/order-checkout.ts.
//
// Back-dating: full-admin callers also get PrepareOptions.allowAnyDeliveryDate,
// so a delivery date in the past (and a slot inside the 12 h lead) is accepted
// — that is how an operator records an order that already happened. Team-PIN
// callers do NOT get it and keep the public booking rules.
//
// Nothing on the PUBLIC checkout path is touched; the override flag is
// only ever set here, on an isAdmin()-gated endpoint.
export async function POST(req: NextRequest) {
  // Dual-auth: full admin OR the narrow team-order token. Team-order
  // callers are subject to additional clamps below (payment forced to
  // COD, status forced to pending, serviceability override discarded).
  if (!verifyAdminOrTeamOrder(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isTeam = !isAdmin(req) && isTeamOrderToken(req);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Team-PIN clamps — enforced BEFORE any DB work so a hand-crafted
  // request cannot bypass the UI restrictions. A team member can only
  // record a pending, unpaid COD order; they can never mark cash
  // collected or bypass serviceability. Any incoming values are
  // silently overridden (rather than rejected) so a stale form can
  // still submit successfully.
  if (isTeam) {
    body.payment = "cod";
    body.status = "pending";
    body.serviceability_override = false;
  }

  // 1. Phone normalisation — 10-digit local. Rejects garbage before we
  //    ever touch the DB. Matches the format customers.phone stores +
  //    the customers_phone_unique index keys on.
  const rawPhone = typeof body.phone === "string" ? body.phone : "";
  const phoneLocal = rawPhone.replace(/\D/g, "").slice(-10);
  if (phoneLocal.length !== 10) {
    return NextResponse.json(
      { error: "Please enter a valid 10-digit phone." },
      { status: 400 },
    );
  }

  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  if (!fullName) {
    return NextResponse.json({ error: "Customer name is required." }, { status: 400 });
  }
  const city = typeof body.city === "string" ? body.city.trim() : "";

  // 2. Customer upsert by phone — never overwrite existing name/city.
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("customers")
    .select("id, full_name, city")
    .eq("phone", phoneLocal)
    .maybeSingle();
  if (lookupErr) {
    console.error("[admin/orders POST] customer lookup failed:", lookupErr.message);
    return NextResponse.json(
      { error: "Failed to resolve customer" },
      { status: 500 },
    );
  }

  let customerId: string;
  if (existing) {
    // Only fill blanks — DO NOT clobber a saved profile. Admin form
    // pre-fills existing name/city read-only, but this is the belt-and-
    // braces guarantee at the API layer.
    const patch: Record<string, string> = {};
    if (!existing.full_name && fullName) patch.full_name = fullName;
    if (!existing.city && city) patch.city = city;
    if (Object.keys(patch).length > 0) {
      const { error: updErr } = await supabaseAdmin
        .from("customers")
        .update(patch)
        .eq("id", existing.id);
      if (updErr) {
        console.error("[admin/orders POST] customer fill failed:", updErr.message);
      }
    }
    customerId = existing.id;
  } else {
    const { data: newCust, error: insErr } = await supabaseAdmin
      .from("customers")
      .insert({
        full_name: fullName,
        phone: phoneLocal,
        ...(city ? { city } : {}),
      })
      .select("id")
      .single();
    if (insErr || !newCust) {
      console.error("[admin/orders POST] customer insert failed:", insErr?.message);
      return NextResponse.json(
        { error: "Failed to create customer" },
        { status: 500 },
      );
    }
    customerId = newCust.id;
  }

  // 3. Run the SAME validation pipeline the public checkout uses.
  //    OTP gate is already soft: with no cookie, effectiveVerifiedPhone
  //    falls back to the customer's stored phone → passes automatically.
  const serviceabilityOverride = body.serviceability_override === true;
  const bodyForPrep = { ...body, customer_id: customerId } as Record<string, unknown>;
  const prep = await prepareOneTimeOrder(bodyForPrep, req, supabaseAdmin, {
    skipServiceability: serviceabilityOverride,
    // Full admin only: allows recording an order that already happened
    // (past delivery date, no 12 h lead). Team-PIN callers keep the public
    // booking rules — same split as serviceability_override above.
    allowAnyDeliveryDate: !isTeam,
  });
  if (!prep.ok) {
    return NextResponse.json(prep.body, { status: prep.status });
  }
  const prepared = prep.data;

  // 4. Payment + status. Manual "paid" orders are cash-collected (no
  //    razorpay_payment_id) so canAutoRefund() correctly returns false —
  //    the auto-refund guard in lib/order-cancellation.ts will not fire.
  const isPaid = body.payment === "paid";
  const rawStatus = typeof body.status === "string" ? body.status.toLowerCase() : "pending";
  const ALLOWED_CREATE_STATUSES = new Set(["pending", "placed", "confirmed"]);
  const status = ALLOWED_CREATE_STATUSES.has(rawStatus) ? rawStatus : "pending";

  const insertRow: Record<string, unknown> = {
    ...orderInsertColumns(prepared),
    status,
    payment_method: "cod",
    payment_status: isPaid ? "paid" : "pending",
    // This route IS the offline channel: an operator typing in an order that
    // was taken over the phone / in person. Independent of payment_status —
    // an offline order can be paid (cash collected) or not.
    source: "offline",
  };
  if (isPaid) {
    insertRow.paid_at = new Date().toISOString();
  }

  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .insert(insertRow)
    .select("id, order_number, public_ref, customer_id, total_amount, status, payment_status")
    .single();

  if (orderErr || !order) {
    console.error("[admin/orders POST] order insert failed:", orderErr?.message);
    return NextResponse.json(
      { error: "Failed to create order", details: orderErr?.message },
      { status: 500 },
    );
  }

  // Admin-registered orders are always payment_method 'cod' (cash-collected
  // even when marked paid on the spot), so they alert on creation like any
  // other COD order. Never awaited; see lib/order-notification.ts.
  queueOrderNotification(order.id, "created");

  void recordAuditEvent({
    req,
    entity: "order",
    action: "create",
    targetId: order.id,
    // OLF code off the INSERT's RETURNING clause — the trigger has
    // already assigned it by the time this row comes back.
    targetLabel: formatOrderNumber(order),
    context: `${isTeam ? "[team-PIN] " : ""}Admin manually registered order for ${phoneLocal}${serviceabilityOverride ? " (serviceability override)" : ""}`,
    meta: {
      phone: phoneLocal,
      customer_id: customerId,
      fulfillment_type: prepared.fulfillmentType,
      total_amount: prepared.grandTotal,
      delivery_fee: prepared.deliveryFee,
      distance_km: prepared.distanceKm,
      serviceability_override: serviceabilityOverride,
      payment: isPaid ? "paid" : "cod",
      status,
      via: isTeam ? "team_order" : "admin",
    },
  });

  // Fire-and-forget SMS + WhatsApp confirmation with tracking link.
  // Same shared builders web + mobile checkout use → identical wording.
  // Failures NEVER block the order response — logged + swallowed. The
  // link lands on /orders/[id]; if the customer isn't signed in, the
  // page triggers the standard OTP flow, then loads because R1 already
  // linked customer_id ↔ phone via the customers_phone_unique index.
  fireAndForgetNotification(
    fetch(`${SITE_URL}/api/send-sms`, {
      method: "POST",
      headers: internalJsonHeaders(),
      body: JSON.stringify({
        type: "order_placed",
        phone: phoneLocal,
        name: fullName,
        orderId: order.id,
        // OLF number — the customer-facing one since 2026-09-14
        // (see lib/order-number.ts).
        orderNumber: order.order_number,
        total: prepared.grandTotal,
        address: prepared.deliveryAddress,
        preorder: prepared.isPreorder,
      }),
    }),
    "send-sms",
    { phone: phoneLocal },
  );

  const waMessage = buildOrderPlacedWhatsApp({
    name: fullName,
    orderId: order.id,
    orderNumber: order.order_number,
    total: prepared.grandTotal,
    address: prepared.deliveryAddress,
    preorder: prepared.isPreorder,
    siteUrl: SITE_URL,
  });
  fireAndForgetNotification(
    fetch(`${SITE_URL}/api/send-whatsapp`, {
      method: "POST",
      headers: internalJsonHeaders(),
      body: JSON.stringify({ phone: phoneLocal, message: waMessage }),
    }),
    "send-whatsapp",
    { phone: phoneLocal },
  );

  return NextResponse.json({
    ok: true,
    order_id: order.id,
    // The OLF code, so the confirmation can name the order the way the rest
    // of the admin does. order_id stays: callers key off it.
    order_number: order.order_number,
    customer_id: customerId,
    total_amount: prepared.grandTotal,
    delivery_fee: prepared.deliveryFee,
  });
}

/**
 * Detaches a notification fetch from the admin-order response lifecycle.
 * Mirror of mobile/checkout's fireAndForget — logs BOTH network failures
 * AND non-2xx responses (Twilio errors come back as 4xx/5xx which fetch
 * does NOT throw on). Phone is masked to the last 4 digits in logs.
 * MUST NEVER throw or block — the order is already committed by the time
 * we get here.
 */
function fireAndForgetNotification(
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
      console.error(`[admin/orders] ${label} http_failed`, {
        status: res.status,
        code: data.code,
        error: data.error,
        phone: maskPhone(ctx.phone),
      });
    }
  }).catch((err) => {
    console.error(`[admin/orders] ${label} threw`, {
      phone: maskPhone(ctx.phone),
      err: String(err),
    });
  });
}
