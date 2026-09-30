// "This customer has been here before."
//
// Present ONLY from the second non-cancelled row onwards, so a first order
// never carries one — a star on everything says nothing. The count is keyed
// on PHONE rather than customer_id, because a second checkout typed with a
// different name mints a fresh customers row and would otherwise read as a
// brand-new customer; see customer-history.ts.
//
// The star itself is not the information — the tooltip is. Which visit this
// is, and when the first one was, is what decides whether to say "welcome
// back" or to look up what went wrong last time.
//
// SIZE IS BANDED, AND BANDED ON `seq` — this row's ordinal, not the
// customer's lifetime total. A star sits on ONE order, so it should say
// what was true when that order was placed; sizing on the lifetime count
// would paint a customer's 2nd order with the star they earned on their
// 6th, a claim about a moment that had not happened yet. On the newest row
// for a customer the two numbers are equal, and that is the row anyone is
// looking at during dispatch.
//
// THE THRESHOLDS ARE THE LIVE DISTRIBUTION, NOT A GUESS. Of 312 customers
// holding a non-cancelled order: 272 have ordered once (no star at all),
// 31 twice, 6 three times, 2 four times, 1 six times. Nobody has more than
// six. So:
//
//   seq 2–3   0.9rem   the size this component already used, so the common
//                      case — 37 of the 40 starred customers — is unchanged
//   seq 4–5   1.15rem  3 customers
//   seq 6+    1.4rem   1 customer, the most loyal on the books
//
// Three bands, every one occupied. A fourth at 8 or 16 would be a band
// nothing can enter, which teaches the eye nothing. Bounded on purpose: the
// top band saturates instead of growing, so the largest star is a fixed,
// known 1.4rem however long a customer keeps buying — a formula on the count
// would eventually deform the row it sits in. Re-cut from the data when the
// shape changes; do not extrapolate.
//
// The exact number stays in the tooltip, which already leads with
// ordinal(seq) — "4th order · first on 5 Sep". The band is the signal, the
// ordinal is the fact, and no one has to count pixels to recover it.

import { repeatTooltip, type RepeatInfo } from "@/lib/customer-history";

/** Font size for a row's ordinal. Bounded — 6+ is the last band. */
function starSize(seq: number): string {
  if (seq >= 6) return "1.4rem";
  if (seq >= 4) return "1.15rem";
  return "0.9rem";
}

export function RepeatStar({
  seq,
  count,
  firstAt,
  noun = "order",
}: {
  /** 1-based position of THIS row among that phone's non-cancelled rows. */
  seq?: number | null;
  count?: number | null;
  firstAt?: string | null;
  /** "order" on the orders board, "plan" on subscriptions. */
  noun?: string;
}) {
  if ((seq ?? 0) < 2) return null;
  const info: RepeatInfo = {
    repeat_seq: seq ?? 0,
    customer_order_count: count ?? 0,
    customer_first_order_at: firstAt ?? "",
  };
  const tooltip = repeatTooltip(info, noun);
  return (
    <span
      title={tooltip}
      // Was the constant "Repeat customer", which overrode the title for
      // assistive tech. Now that the SIZE carries the ordinal, a reader who
      // cannot see the size would have no way to reach it at all, so the
      // label says the same thing the tooltip does.
      aria-label={tooltip}
      style={{
        marginLeft: 6,
        color: "#FBF3D4",
        fontSize: starSize(info.repeat_seq),
        // Keeps a 1.4rem glyph from stretching the row's line box.
        lineHeight: 1,
        verticalAlign: "middle",
        cursor: "help",
      }}
    >
      ★
    </span>
  );
}
