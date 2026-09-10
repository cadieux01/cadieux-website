// The money breakdown shared by the admin order detail and the admin
// subscription detail: a line-item table followed by a right-aligned
// totals column.
//
// Extracted verbatim from /admin/orders/[id] so the two pages cannot drift
// apart. Sunny reads both, and an order and a subscription that describe
// the same thing in two different shapes is how you get a support call.
// The markup and the style objects below are byte-identical to what the
// orders page rendered inline before the extraction — see the commit that
// introduced this file.
//
// Deliberately dumb. It takes already-formatted strings and does NO money
// math of its own. Every arithmetic decision (what the subtotal is, whether
// a fee was actually charged, what reconciles against the stored total)
// belongs to the caller, which is the only place that knows what the
// numbers mean. A component that quietly re-derives a total is a component
// that can disagree with the database.

import React from "react";

export type MoneyBreakdownLine = {
  /** React key. Never rendered. */
  key: string;
  name: React.ReactNode;
  qty: React.ReactNode;
  unit: React.ReactNode;
  total: React.ReactNode;
};

export type MoneyBreakdownTotal = {
  key: string;
  label: React.ReactNode;
  value: React.ReactNode;
  /** Renders the top-ruled final row. At most one row should set this. */
  grand?: boolean;
  /**
   * Optional caption under the row. Used for the "recorded but never
   * charged" delivery fee on legacy subscriptions; omitted everywhere
   * else, so pages that pass no note render exactly the DOM they did
   * before this component existed.
   */
  note?: React.ReactNode;
};

export function MoneyBreakdown({
  qtyHeading = "Qty",
  emptyLabel,
  lines,
  totals,
}: {
  /** "Qty" for orders, "Qty / delivery" for subscriptions. */
  qtyHeading?: string;
  emptyLabel: string;
  lines: MoneyBreakdownLine[];
  totals: MoneyBreakdownTotal[];
}) {
  return (
    <>
      <div style={tableWrap}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={tableHeadRow}>
              <th style={th}>Product</th>
              <th style={{ ...th, width: 80, textAlign: "right" }}>
                {qtyHeading}
              </th>
              <th style={{ ...th, width: 120, textAlign: "right" }}>
                Unit price
              </th>
              <th style={{ ...th, width: 130, textAlign: "right" }}>
                Line total
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td style={td} colSpan={4}>
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              lines.map((line) => (
                <tr key={line.key}>
                  <td style={td}>{line.name}</td>
                  <td style={{ ...td, textAlign: "right" }}>{line.qty}</td>
                  <td style={{ ...td, textAlign: "right" }}>{line.unit}</td>
                  <td style={{ ...td, textAlign: "right" }}>{line.total}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={totalsBlock}>
        {totals.map((row) => (
          // A Fragment renders no DOM of its own, so a row without a note
          // produces exactly the markup the orders page produced inline.
          <React.Fragment key={row.key}>
            <div
              style={row.grand ? { ...totalsRow, ...totalsGrand } : totalsRow}
            >
              <span>{row.label}</span>
              <span>{row.value}</span>
            </div>
            {row.note ? <div style={totalsNote}>{row.note}</div> : null}
          </React.Fragment>
        ))}
      </div>
    </>
  );
}

const tableWrap: React.CSSProperties = {
  border: "1px solid rgba(251,243,212,0.18)",
  borderRadius: 6,
  overflow: "hidden",
};

const tableHeadRow: React.CSSProperties = {
  background: "rgba(251,243,212,0.08)",
  color: "rgba(251,243,212,0.9)",
  textTransform: "uppercase",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "0.7rem 1rem",
  fontFamily: "var(--font-body)",
  fontWeight: 400,
  borderBottom: "1px solid rgba(251,243,212,0.15)",
};

const td: React.CSSProperties = {
  padding: "0.7rem 1rem",
  fontFamily: "var(--font-body)",
  color: "#FBF3D4",
  fontSize: "1rem",
  verticalAlign: "top",
  borderBottom: "1px solid rgba(251,243,212,0.06)",
};

const totalsBlock: React.CSSProperties = {
  marginTop: "1rem",
  marginLeft: "auto",
  width: "min(340px, 100%)",
  display: "flex",
  flexDirection: "column",
  gap: "0.3rem",
};

const totalsRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontFamily: "var(--font-body)",
  fontSize: "1rem",
  color: "#FBF3D4",
  padding: "0.15rem 0",
};

// Caption under a totals row. Only ever rendered when a caller passes a
// `note`, which today is the not-charged delivery fee on legacy
// subscriptions.
const totalsNote: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "0.8125rem",
  lineHeight: 1.45,
  color: "rgba(251,243,212,0.6)",
  padding: "0 0 0.2rem",
};

const totalsGrand: React.CSSProperties = {
  borderTop: "1px solid rgba(251,243,212,0.35)",
  marginTop: "0.35rem",
  paddingTop: "0.5rem",
  fontSize: "1rem",
  color: "#FBF3D4",
};
