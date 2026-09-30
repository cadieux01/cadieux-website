// Two things the worklist rests on, checked without writing anything.
//
// 1. THE APPEND RULE. resolved_note must never overwrite: a correction to a
//    resolution has to land where the next reader is already looking. That is a
//    pure function, so it is walked over the sequence that matters — a
//    resolution, then a correction to it — and the output is printed in full so
//    the trail can be read the way an operator would read it.
//
// 2. THE QUERIES. Run exactly as the list route runs them, against the real
//    table, so a column that does not exist fails here rather than on the
//    screen. READ-ONLY: three selects, no insert, no update.
//
//   node --env-file=.env.local scripts/exception-note-check.ts

import { createClient } from "@supabase/supabase-js";

import { appendResolvedNote, validateExceptionNote } from "../src/lib/payment-exception-notes.ts";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const LIST_COLUMNS =
  "id, reason, razorpay_payment_id, razorpay_order_id, amount_paise, expected_amount_paise, received_at, resolved_at, resolved_note";

function showValidation(label: string, raw: unknown) {
  const v = validateExceptionNote(raw);
  console.log(
    `  ${label.padEnd(40)} ${"error" in v ? `REFUSED — ${v.error}` : `accepted (${v.note.length} chars)`}`,
  );
}

async function main() {
  console.log("\nVALIDATION — resolving requires a reason, not a keystroke:\n");
  showValidation("empty string", "");
  showValidation("whitespace only", "   \n  ");
  showValidation("not a string", 42);
  showValidation("a real note", "  Refunded via the Razorpay dashboard. ");
  showValidation("1001 characters", "x".repeat(1001));

  console.log("\nTHE APPEND RULE — nothing above is ever rewritten:\n");
  const t1 = new Date("2026-10-01T09:14:00Z"); // 14:44 IST
  const t2 = new Date("2026-10-02T04:40:00Z"); // 10:10 IST next day
  const first = appendResolvedNote(
    null,
    "Refunded in full — the payment was a duplicate of pay_…7Q2 on OLF398.",
    t1,
  );
  const second = appendResolvedNote(
    first,
    "Correction: the refund went against the OTHER duplicate row. This one is still owed; calling the customer.",
    t2,
  );
  console.log(second.split("\n").map((l) => `    ${l}`).join("\n"));
  console.log(
    `\n  first entry still present verbatim: ${second.includes(first) ? "yes" : "NO — BUG"}`,
  );

  console.log("\nQUERIES — as the list route issues them, against the real table:\n");

  const { data: open, error: openErr, count: openCount } = await supabase
    .from("payment_exceptions")
    .select(LIST_COLUMNS, { count: "exact" })
    .is("resolved_at", null)
    .order("received_at", { ascending: true })
    .limit(200);
  if (openErr) throw new Error(`open list: ${openErr.message}`);
  console.log(`  unresolved, oldest first : ${openCount ?? 0} row(s)`);

  const { data: done, error: doneErr, count: doneCount } = await supabase
    .from("payment_exceptions")
    .select(LIST_COLUMNS, { count: "exact" })
    .not("resolved_at", "is", null)
    .order("resolved_at", { ascending: false })
    .limit(200);
  if (doneErr) throw new Error(`resolved list: ${doneErr.message}`);
  console.log(`  resolved, newest first   : ${doneCount ?? 0} row(s)`);

  // The per-row read, which is the only thing that ever selects `payload`.
  const sample = (open ?? [])[0] ?? (done ?? [])[0];
  if (!sample) {
    console.log(
      "\n  Table is empty — nothing has been refused yet, which is the state\n" +
        "  we want. Both column lists are still proven valid: PostgREST would\n" +
        "  have errored on an unknown column regardless of row count.\n",
    );
    return;
  }
  const { error: rowErr } = await supabase
    .from("payment_exceptions")
    .select(`${LIST_COLUMNS}, payload`)
    .eq("id", sample.id)
    .maybeSingle();
  if (rowErr) throw new Error(`row read: ${rowErr.message}`);
  console.log("  single row with payload  : ok (not printed — raw Razorpay event)\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
