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

import { repeatTooltip, type RepeatInfo } from "@/lib/customer-history";

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
  return (
    <span
      title={repeatTooltip(info, noun)}
      aria-label="Repeat customer"
      style={{
        marginLeft: 6,
        color: "#FBF3D4",
        fontSize: "0.9rem",
        cursor: "help",
      }}
    >
      ★
    </span>
  );
}
