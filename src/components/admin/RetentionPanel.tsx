"use client";

// Retention at a glance, above the orders table.
//
// ALL-TIME AND UNFILTERED ON PURPOSE. The date range and the status
// filter above it change what the table shows; they do not change how
// many customers have ever come back. A retention number that moved when
// you picked "This month" would be read as churn.
//
// Every figure is by PHONE and excludes cancelled orders — see
// src/lib/customer-history.ts, which computes this inside the list
// endpoint in the same pass that stars the rows.

import type { RetentionSummary } from "@/lib/customer-history";
import { BORDER_SUBTLE, CREAM, TEXT_MUTED } from "./theme";

function pctLabel(v: number | null): string {
  return v === null ? "—" : `${v}%`;
}

export function RetentionPanel({ data }: { data: RetentionSummary }) {
  if (data.customers === 0) return null;

  return (
    <section
      style={{
        border: `1px solid ${BORDER_SUBTLE}`,
        borderRadius: 6,
        padding: "0.85rem 1rem",
        marginBottom: "1.25rem",
        fontFamily: "var(--font-body)",
      }}
      aria-label="Retention overview"
    >
      <h2
        className="uppercase"
        style={{
          margin: 0,
          fontSize: "0.7rem",
          letterSpacing: "0.18em",
          color: TEXT_MUTED,
        }}
      >
        Retention · all time
      </h2>

      <div
        className="flex flex-wrap"
        style={{ gap: "1.75rem", marginTop: "0.75rem" }}
      >
        <Stat label="Customers" value={String(data.customers)} />
        <Stat
          label="Ordered again"
          value={String(data.ordered_again)}
          note={pctLabel(data.ordered_again_pct)}
        />
        <Stat label="3+ orders" value={String(data.three_plus)} />
        <Stat
          label="Repeat share of revenue"
          value={pctLabel(data.repeat_revenue_pct)}
          title="Revenue from customers with 2+ orders ÷ all revenue. Cancelled orders excluded."
        />
      </div>

      {/* The honest version: a customer who first ordered yesterday has
          not failed to come back, they have not had the chance. Bucketing
          by days since FIRST order keeps them from dragging the headline
          down. */}
      <table
        style={{
          marginTop: "1rem",
          borderCollapse: "collapse",
          fontSize: "0.85rem",
          color: CREAM,
        }}
      >
        <tbody>
          {data.cohorts.map((c) => (
            <tr key={c.key}>
              <td style={{ padding: "3px 1.25rem 3px 0", color: TEXT_MUTED }}>
                {c.label}
              </td>
              <td style={{ padding: "3px 1.25rem 3px 0" }}>
                {c.customers} customer{c.customers === 1 ? "" : "s"}
              </td>
              <td style={{ padding: "3px 0" }}>
                {c.returned} came back
                {c.returned > 0 ? (
                  <span style={{ color: TEXT_MUTED }}>
                    {" "}
                    ({pctLabel(c.pct)})
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Stat({
  label,
  value,
  note,
  title,
}: {
  label: string;
  value: string;
  note?: string;
  title?: string;
}) {
  return (
    <div title={title} style={title ? { cursor: "help" } : undefined}>
      <div
        className="uppercase"
        style={{
          fontSize: "0.65rem",
          letterSpacing: "0.14em",
          color: TEXT_MUTED,
        }}
      >
        {label}
      </div>
      <div style={{ color: CREAM, fontSize: "1.35rem", lineHeight: 1.2 }}>
        {value}
        {note ? (
          <span style={{ color: TEXT_MUTED, fontSize: "0.9rem" }}>
            {" "}
            ({note})
          </span>
        ) : null}
      </div>
    </div>
  );
}
