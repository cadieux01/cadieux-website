// Runs the razorpay-webhook ladder over real prod-shaped events.
//
//   node --env-file=.env.local scripts/classify-check.ts
//
// WHY THIS EXISTS. The branch that matters most — money captured for something
// we cannot identify — cannot be produced on demand. Razorpay will not send a
// payment for an order that does not exist because you would like to see what
// happens. So the decision is a pure function, and this walks it through every
// rung of the ladder using razorpay order ids that are really on prod.
//
// READ-ONLY. Two selects per case, the same two the route performs. It writes
// nothing, sends nothing and marks nothing. Safe to run against prod, which is
// the entire point: the subscription case is only meaningful if the row it
// matches is one of the real ones.
//
// The ids are read out of prod at run time rather than pasted in, so this does
// not rot into a test against a row somebody archived.

import { createClient } from "@supabase/supabase-js";

import {
  classifyRazorpayEvent,
  type Parent,
  type RzpEvent,
} from "../src/lib/razorpay-webhook-classify.ts";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** The route's own resolution step: orders first, then subscriptions. */
async function resolveParent(rzpOrderId: string | null): Promise<Parent> {
  if (!rzpOrderId) return { kind: "none" };
  const { data: order } = await supabase
    .from("orders")
    .select("id, total_amount, payment_status, payment_group_id")
    .eq("razorpay_order_id", rzpOrderId)
    .limit(1)
    .maybeSingle();
  if (order) return { kind: "order", ...order };
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("razorpay_order_id", rzpOrderId)
    .limit(1)
    .maybeSingle();
  if (sub) return { kind: "subscription" };
  return { kind: "none" };
}

function captured(rzpOrderId: string, amountPaise: number): RzpEvent {
  return {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_CHECKONLYNOTREAL",
          order_id: rzpOrderId,
          amount: amountPaise,
          status: "captured",
        },
      },
    },
  };
}

/** Masked so a transcript of this run does not carry live payment ids. */
function mask(id: string | null): string {
  if (!id) return "(none)";
  return id.length <= 12 ? id : `${id.slice(0, 9)}…${id.slice(-3)}`;
}

async function main() {
  // A real unpaid order, a real paid subscription. Pulled live.
  const { data: ord } = await supabase
    .from("orders")
    .select("razorpay_order_id, total_amount")
    .not("razorpay_order_id", "is", null)
    .neq("payment_status", "paid")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("razorpay_order_id, total_amount")
    .not("razorpay_order_id", "is", null)
    .eq("payment_status", "paid")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const orderId: string = ord!.razorpay_order_id;
  const orderPaise = Math.round(Number(ord!.total_amount) * 100);
  const subId: string = sub!.razorpay_order_id;
  const subPaise = Math.round(Number(sub!.total_amount) * 100);

  const cases: Array<{ rung: string; label: string; event: RzpEvent }> = [
    {
      rung: "2",
      label: "our order, captured for the amount owed",
      event: captured(orderId, orderPaise),
    },
    {
      rung: "2",
      label: "our order, captured for the WRONG amount",
      event: captured(orderId, orderPaise - 5000),
    },
    {
      rung: "3",
      label: "a real paid SUBSCRIPTION's payment",
      event: captured(subId, subPaise),
    },
    {
      rung: "4",
      label: "unknown id, payment.failed — no money moved",
      event: {
        event: "payment.failed",
        payload: {
          payment: {
            entity: {
              id: "pay_CHECKONLYNOTREAL",
              order_id: "order_NoSuchOrderXX",
              amount: 29500,
              status: "failed",
            },
          },
        },
      },
    },
    {
      rung: "5",
      label: "unknown id, money CAPTURED",
      event: captured("order_NoSuchOrderXX", 29500),
    },
    {
      rung: "1",
      label: "an event carrying no razorpay order id",
      event: { event: "payment.captured", payload: {} },
    },
  ];

  for (const c of cases) {
    const rzpOrderId =
      c.event.payload?.payment?.entity?.order_id ??
      c.event.payload?.order?.entity?.id ??
      null;
    const parent = await resolveParent(rzpOrderId);
    const out = classifyRazorpayEvent(c.event, parent);
    console.log(
      [
        `rung ${c.rung}  ${c.label}`,
        `        id=${mask(rzpOrderId)}  parent=${parent.kind}`,
        `        → ${out.branch}  ${out.loud ? "LOUD — records + alerts" : "quiet"}`,
      ].join("\n"),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
