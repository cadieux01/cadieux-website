// Walks decideReuse() over every Razorpay order shape that matters, plus the
// real amounts of the live orders this change actually affects.
//
// WHY A HARNESS. A part-paid Razorpay order, or one whose amount moved after
// the id was minted, cannot be produced on demand — the same problem as the
// unattributed capture in the webhook, and the same answer: test the pure
// decision, and take the real numbers from prod so the case list is not a
// guess about which orders are in scope.
//
// READ-ONLY. One select. No Razorpay call is made (this env holds no Razorpay
// credentials), no row is written, and no id is printed in full.
//
//   node --env-file=.env.local scripts/reuse-check.ts

import { createClient } from "@supabase/supabase-js";

import { decideReuse, type RazorpayOrderBody } from "../src/lib/razorpay-order-reuse.ts";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function mask(s: string | null): string {
  if (!s) return "(none)";
  return s.length <= 12 ? s : `${s.slice(0, 10)}…`;
}

function show(label: string, body: RazorpayOrderBody | null, expected: number) {
  const d = decideReuse(body, expected);
  const verdict = d.reuse
    ? "REUSE"
    : `mint (${d.why})${d.loud ? "  ← LOUD" : ""}`;
  console.log(`  ${label.padEnd(46)} ${verdict}`);
}

async function main() {
  // The population in scope, filtered exactly as the route's own guards filter
  // it: Pay Now refuses anything that is already paid, not COD, or cancelled.
  // Every remaining row is one where a second press used to orphan the id it
  // is already holding.
  const { data: atRisk, error } = await supabase
    .from("orders")
    .select("id, order_number, total_amount, payment_status, razorpay_order_id")
    .not("razorpay_order_id", "is", null)
    .neq("payment_status", "paid")
    .eq("payment_method", "cod")
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = atRisk ?? [];
  console.log(
    `\nIN SCOPE: ${rows.length} orders Pay Now would accept that already hold a\n` +
      `razorpay_order_id. A second press on any of these used to orphan it.\n`,
  );

  const sample = rows[0];
  if (!sample) {
    console.log("No such rows right now — using synthetic amounts only.\n");
  } else {
    console.log(
      `Sample row: ${sample.order_number ?? sample.id.slice(0, 8)}  ` +
        `total=₹${sample.total_amount}  rzp=${mask(sample.razorpay_order_id)}\n`,
    );
  }

  // The amount a real row would ask Razorpay to match, computed exactly as the
  // route computes it.
  const expected = sample
    ? Math.round(Number(sample.total_amount) * 100)
    : 45000;

  console.log(`decideReuse(body, expectedPaise=${expected}):\n`);

  show(
    "created, untouched, same amount",
    { status: "created", amount: expected, amount_paid: 0, currency: "INR" },
    expected,
  );
  show(
    "attempted, payment FAILED, same amount",
    { status: "attempted", amount: expected, amount_paid: 0, currency: "INR" },
    expected,
  );
  show(
    "attempted, part-paid",
    { status: "attempted", amount: expected, amount_paid: 100, currency: "INR" },
    expected,
  );
  show(
    "PAID — money captured, our row says unpaid",
    {
      status: "paid",
      amount: expected,
      amount_paid: expected,
      currency: "INR",
    },
    expected,
  );
  show(
    "created, but the total moved since (admin edit)",
    {
      status: "created",
      amount: expected + 3000,
      amount_paid: 0,
      currency: "INR",
    },
    expected,
  );
  show(
    "created, same amount, wrong currency",
    { status: "created", amount: expected, amount_paid: 0, currency: "USD" },
    expected,
  );
  show("Razorpay returned nothing parseable", null, expected);
  show("Razorpay returned a body with no status", { amount: expected }, expected);

  console.log(
    "\nNot exercised here because they never reach decideReuse — the fetch\n" +
      "wrapper refuses first, and refusal is the same fall-through to minting:\n" +
      "  timeout / network error   → mint (<the error message>)\n" +
      "  any non-2xx from Razorpay → mint (razorpay_http_<code>)\n",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
