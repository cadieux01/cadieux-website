"use client";

// A SHEET REFUSES A WHOLE PERIOD, AND SAYS SO.
//
// /admin/orders can be filtered to a week or a month. The two sheets cut
// from it — the kitchen packing list and the rider's run sheet — cannot be,
// and this is the page an operator gets if they try.
//
// WHY NOT JUST PRINT THE WEEK. Both sheets are worked one day at a time:
// crates packed for a slot, stops driven on a route. A sheet holding seven
// days of the same address, or the same name against three dates, is not a
// longer version of the right document, it is a different and wrong one.
// This is the failure day-filter.ts's header records — the print view once
// listing 60 orders while the screen showed 9 — and it is exactly as bad in
// the other direction.
//
// WHY NOT SILENTLY NARROW IT TO TODAY. Because then the sheet and the
// screen disagree and nothing says so, which is the whole bug. A refusal is
// visible; a quiet substitution is discovered in the kitchen.
//
// WHY NOT DROP THE PARAM ON THE WAY OVER. Forwarding nothing would make the
// sheet read "all dates" and print the entire table. The board forwards the
// span precisely so this page can see it and stop.
//
// THE CSV IS NOT WITHHELD. A spreadsheet is read, sorted and summed, not
// packed from — a month in a file is a perfectly good month. The export on
// the board honours the span and says what scope it wrote. Only the two
// printable sheets refuse.

import Link from "next/link";

export type SpanRefusalProps = {
  /** "This week" / "This month" — the operator's own words back at them. */
  label: string;
  /** Which sheet refused, for the heading. */
  sheet: string;
  /** The board URL to go back to, carrying the filter they already set so
   *  the refusal is not also a loss of work. */
  backHref: string;
};

const page: React.CSSProperties = {
  background: "#FFFFFF",
  color: "#1D1D1F",
  minHeight: "100vh",
  padding: "2rem",
  fontFamily: "var(--font-body)",
  maxWidth: 680,
};

export function SpanRefusal({ label, sheet, backHref }: SpanRefusalProps) {
  return (
    <main style={page}>
      <h1 style={{ fontSize: "1.4rem", margin: 0, letterSpacing: "0.1em" }}>
        Cadieux — {sheet}
      </h1>
      <p style={{ marginTop: "1rem", fontSize: "1rem", lineHeight: 1.6 }}>
        Nothing was printed. The board is filtered to{" "}
        <strong>{label.toLowerCase()}</strong>, and this sheet is cut for{" "}
        <strong>one day</strong>.
      </p>
      <p style={{ fontSize: "1rem", lineHeight: 1.6 }}>
        It is packed from and driven from a day at a time, so a sheet holding
        a whole period would put the same address on it several times over —
        and a sheet that quietly printed only today would disagree with the
        screen it came from without saying so.
      </p>
      <p style={{ fontSize: "1rem", lineHeight: 1.6 }}>
        Go back, pick a single date, and print again. Your other filters are
        kept. If you wanted {label.toLowerCase()} as a whole, use{" "}
        <strong>Download CSV</strong> on the board — that one does honour the
        period.
      </p>
      <p style={{ marginTop: "1.5rem" }}>
        <Link
          href={backHref}
          style={{
            display: "inline-block",
            padding: "0.6rem 1rem",
            border: "1px solid #1D1D1F",
            color: "#1D1D1F",
            textDecoration: "none",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontSize: "0.8rem",
          }}
        >
          Back to the board
        </Link>
      </p>
    </main>
  );
}
