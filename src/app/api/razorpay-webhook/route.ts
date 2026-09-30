// POST /api/razorpay-webhook
//
// Server-to-server backup for marking orders paid. If the browser closes
// before /api/verify-payment runs (network drop, tab closed right after
// paying), Razorpay still delivers a signed webhook and this endpoint
// reconciles the order. Both paths are idempotent and converge on the
// same `paid` state.
//
// Configure in the Razorpay dashboard:
//   URL:    https://www.cadieux.in/api/razorpay-webhook
//   Secret: value of RAZORPAY_WEBHOOK_SECRET (set the SAME value in Vercel)
//   Events: payment.captured, payment.failed, order.paid
//
// Security: the X-Razorpay-Signature header is an HMAC-SHA256 of the EXACT
// raw request body keyed by the webhook secret. We must hash the unparsed
// bytes — re-serialising the JSON would change them and break the check.
//
// IT IS ALSO THE LAST PLACE A CAPTURED PAYMENT CAN BE NOTICED. Two branches
// here used to end in a bare {ok:true} on money Razorpay had already taken: a
// payment matching no order, and a payment for an amount that is not the
// amount owed. Both were silent, so both stayed invisible until a customer
// complained. Neither can be answered automatically without guessing about
// money, so both now write a payment_exceptions row and ring a doorbell — the
// decision of which is which lives in @/lib/razorpay-webhook-classify.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

import { queueOrderNotification } from "@/lib/order-notification";
import { queuePaymentExceptionAlert } from "@/lib/payment-exception-alert";
import { formatOrderNumber } from "@/lib/order-number";
import {
  classifyRazorpayEvent,
  extractRzpOrderId,
  type Parent,
  type RzpEvent,
} from "@/lib/razorpay-webhook-classify";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Write the durable record, then ring the doorbell — but only for a record we
 * actually created.
 *
 * `ignoreDuplicates` is PostgREST's ON CONFLICT DO NOTHING, and `.select("id")`
 * then returns the inserted row or NOTHING AT ALL. That emptiness is the whole
 * mechanism: Razorpay retries an un-acked webhook, and without it every retry
 * would be another email — an alert channel destroying itself at exactly the
 * moment it is carrying real news.
 *
 * The conflict target can only name one index. A payment id repeat is caught by
 * `ignoreDuplicates`; a repeat of the OTHER dedupe — the partial unique on
 * razorpay_order_id, used when an event carries no payment id — comes back as a
 * 23505 unique violation instead. Same meaning, different shape, so it is
 * treated the same: seen before, stay quiet.
 *
 * KNOWN COST: any OTHER insert failure still sends the email, with the id
 * replaced by a marker. That is deliberate. If the row cannot be written the
 * email is the only trace left of captured money, and a handful of duplicate
 * alerts during an outage is a far smaller loss than silence.
 */
async function recordPaymentException(args: {
  reason: "unattributed" | "amount_mismatch";
  /** Null when the event stated no amount. Stored as 0 — the column is NOT
   *  NULL — so read the payload for the truth in that case. */
  amountPaise: number | null;
  expectedPaise: number | null;
  razorpayPaymentId: string | null;
  razorpayOrderId: string | null;
  orderRef: string | null;
  payload: unknown;
}): Promise<void> {
  // Layer three of the same doctrine: the log. Grep PAYMENT_EXCEPTION.
  console.error(`⚠️  PAYMENT_EXCEPTION ${args.reason}`, {
    razorpayOrderId: args.razorpayOrderId,
    razorpayPaymentId: args.razorpayPaymentId,
    amountPaise: args.amountPaise,
    expectedPaise: args.expectedPaise,
    orderRef: args.orderRef,
  });

  const { data, error } = await supabaseAdmin
    .from("payment_exceptions")
    .upsert(
      {
        reason: args.reason,
        razorpay_payment_id: args.razorpayPaymentId,
        razorpay_order_id: args.razorpayOrderId,
        amount_paise: args.amountPaise ?? 0,
        expected_amount_paise: args.expectedPaise,
        payload: args.payload,
      },
      { onConflict: "razorpay_payment_id", ignoreDuplicates: true },
    )
    .select("id");

  if (error) {
    if (error.code === "23505") {
      console.warn("[razorpay-webhook] exception already recorded — no alert");
      return;
    }
    console.error(
      "[razorpay-webhook] payment_exceptions insert FAILED:",
      error.message,
    );
  } else if (!data || data.length === 0) {
    // A retry of something already on the worklist.
    return;
  }

  queuePaymentExceptionAlert({
    id: data?.[0]?.id ?? "(row not written — see server logs)",
    reason: args.reason,
    amountPaise: args.amountPaise,
    expectedPaise: args.expectedPaise,
    razorpayPaymentId: args.razorpayPaymentId,
    razorpayOrderId: args.razorpayOrderId,
    orderRef: args.orderRef,
  });
}

export async function POST(req: NextRequest) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  // Raw body is mandatory for an exact-bytes HMAC.
  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  if (!signature || !safeEqualHex(expected, signature)) {
    console.warn("⚠️  razorpay-webhook bad signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: RzpEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  const payment = event.payload?.payment?.entity;
  // order.paid carries the order entity; payment.* carry the payment entity
  // whose order_id points back at our order.
  const rzpOrderId = extractRzpOrderId(event);

  // WHAT DOES THIS ID BELONG TO? Orders first, then subscriptions. The second
  // lookup is new and is what keeps the ladder honest: this endpoint only ever
  // reconciles orders, so before the ladder existed every one of the 46
  // subscription payments on prod fell out of the order query empty-handed and
  // was indistinguishable from money we could not identify. Naming them here
  // is what makes it safe for the unattributed case to be loud.
  let orderRow: {
    id: string;
    order_number: string | null;
    total_amount: number | string | null;
    payment_status: string | null;
    payment_group_id: string | null;
  } | null = null;
  let parent: Parent = { kind: "none" };

  if (rzpOrderId) {
    // LOOKUP LANDMINE (SANDWICH_CHECKOUT_BLOCK_CODE) — under the OLF/OLW split,
    // admin_create_split_orders stamps THE SAME razorpay_order_id onto BOTH
    // rows (bread + sandwich). This query then matches two rows, and
    // .maybeSingle() ERRORS on >1 rows (PostgREST returns "multiple rows
    // returned" rather than a row). The webhook then falls into the orderErr
    // branch below and bails without marking anything paid — on the BACKUP
    // path that exists precisely for the case where the client-side
    // /api/verify-payment never ran. Failure mode: customer's money captured,
    // no row marked paid, opaque "Lookup failed" 500 in logs, no signal that
    // it's the split at fault. WORSE than the amount-check landmine, which
    // fails with a named reason ("not_captured" / amount_mismatch).
    //
    // FIX (step 5 route wiring, DO NOT do it here): add `.limit(1)` before
    // `.maybeSingle()`. Behaviour-identical today (one row matched anyway
    // because groups don't exist yet) and correct under groups — both members
    // share razorpay_order_id AND payment_group_id, so picking either row is
    // enough for the branch below to fan the UPDATE out to the whole group.
    //
    // grep SANDWICH_CHECKOUT_BLOCK_CODE now surfaces THREE kinds of landmine:
    //   • sandwich checkout refusal — remove to let mixed carts through
    //   • amount-check landmine (×4) — expectedAmount is per-row, not per-group
    //   • lookup landmine (×1, this one) — .maybeSingle() cannot survive a group
    // Whoever runs the step-5 sweep must understand they are not the same fix.
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("orders")
      .select("id, order_number, total_amount, payment_status, payment_group_id")
      .eq("razorpay_order_id", rzpOrderId)
      .maybeSingle();
    if (orderErr) {
      // A LOOKUP FAILURE IS NOT A PAYMENT EXCEPTION. We do not know what this
      // payment is because our own database did not answer, not because the
      // payment is unattributable. 500 so Razorpay retries and we get a second
      // chance to classify it correctly; recording it as unattributed here
      // would put a resolvable payment on a human's worklist.
      console.error("[razorpay-webhook] order fetch failed:", orderErr.message);
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }
    if (order) {
      orderRow = order;
      parent = {
        kind: "order",
        id: order.id,
        total_amount: order.total_amount,
        payment_status: order.payment_status,
        payment_group_id: order.payment_group_id,
      };
    } else {
      // `.limit(1)` deliberately, unlike the orders query above: a payment is
      // one payment, and one matching subscription is all this rung needs to
      // know. It also cannot acquire the multi-row landmine documented there.
      const { data: sub, error: subErr } = await supabaseAdmin
        .from("subscriptions")
        .select("id")
        .eq("razorpay_order_id", rzpOrderId)
        .limit(1)
        .maybeSingle();
      if (subErr) {
        console.error(
          "[razorpay-webhook] subscription fetch failed:",
          subErr.message,
        );
        return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
      }
      if (sub) parent = { kind: "subscription" };
    }
  }

  // THE LADDER. Pure, and exercised over real prod-shaped events by
  // scripts/classify-check.ts — the unattributed branch cannot be produced on
  // demand, so it is proven there rather than waited for here.
  const outcome = classifyRazorpayEvent(event, parent);

  // EVERY PATH BELOW RETURNS 200. The systemic case is the one that matters:
  // if something is wrong with every event, a 5xx cascade loses the lot behind
  // Razorpay's retry limit, whereas 200 plus a row keeps each one recorded.
  switch (outcome.branch) {
    // Nothing to reconcile, and nothing was at stake.
    case "ignored":
      return NextResponse.json({
        ok: true,
        ignored: event.event ?? null,
        why: outcome.why,
      });

    // A subscription's payment. Reconciled by its own verify path and its own
    // daily sweeper — see the ladder header for why this must stay quiet.
    case "subscription":
      return NextResponse.json({ ok: true, subscription: true });

    case "already_paid":
      return NextResponse.json({ ok: true, already: true });

    // Under the OLF/OLW cart split, one Razorpay payment covers BOTH order
    // rows sharing a payment_group_id. Marking one row (paid or failed) must
    // flip its sibling in the same UPDATE. Rows outside a split have
    // payment_group_id = NULL and fall through to the by-id path unchanged.
    case "mark_failed": {
      // Only reachable when the ladder resolved this to one of our orders,
      // which is the same condition that set orderRow.
      const row = orderRow!;
      const q = supabaseAdmin
        .from("orders")
        .update({ payment_status: "failed" })
        .neq("payment_status", "paid");
      await (row.payment_group_id
        ? q.eq("payment_group_id", row.payment_group_id)
        : q.eq("id", row.id));
      return NextResponse.json({ ok: true });
    }

    case "mark_paid": {
      const row = orderRow!;
      const q = supabaseAdmin
        .from("orders")
        .update({
          payment_status: "paid",
          ...(payment?.id ? { razorpay_payment_id: payment.id } : {}),
          paid_at: new Date().toISOString(),
        })
        .neq("payment_status", "paid");
      await (row.payment_group_id
        ? q.eq("payment_group_id", row.payment_group_id)
        : q.eq("id", row.id));

      // Money has arrived — alert now. Races /api/verify-payment for the same
      // payment; UNIQUE(order_id, event) on order_notifications_sent decides
      // which one actually sends.
      queueOrderNotification(row.id, "paid");

      return NextResponse.json({ ok: true });
    }

    // AMOUNT-CHECK LANDMINE (SANDWICH_CHECKOUT_BLOCK_CODE) — under the split,
    // the captured amount is (bread.total + sandwich.total) × 100, but the
    // expected figure comes from a SINGLE row's total, so every split payment
    // would land here. Step 5 (route wiring) MUST fix this in the same sweep
    // that removes the sandwich checkout refusal — grep
    // SANDWICH_CHECKOUT_BLOCK_CODE. Until then the failure is at least no
    // longer silent: it becomes a row someone can see and close.
    //
    // NEVER AUTO-MARK PAID ON A MISMATCH. Marking it understates what is owed;
    // ignoring it loses a real payment. It is a two-minute human decision
    // against an unbounded automated mistake.
    case "amount_mismatch":
      await recordPaymentException({
        reason: "amount_mismatch",
        amountPaise: outcome.capturedPaise,
        expectedPaise: outcome.expectedPaise,
        razorpayPaymentId: payment?.id ?? null,
        razorpayOrderId: rzpOrderId,
        orderRef: orderRow ? formatOrderNumber(orderRow) : null,
        payload: event,
      });
      return NextResponse.json({ ok: true, amount_mismatch: true });

    // Money captured for something we cannot name. This used to be a bare
    // {ok:true} — a silent success ack on money that had already left a
    // customer's account.
    case "unattributed":
      await recordPaymentException({
        reason: "unattributed",
        amountPaise: outcome.capturedPaise,
        // No parent, so nothing was owed. Null rather than 0, which would
        // read as "we expected nothing" instead of "there is nothing to ask".
        expectedPaise: null,
        razorpayPaymentId: payment?.id ?? null,
        razorpayOrderId: rzpOrderId,
        orderRef: null,
        payload: event,
      });
      return NextResponse.json({ ok: true, unattributed: true });
  }
}
