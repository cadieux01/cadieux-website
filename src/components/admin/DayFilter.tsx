"use client";

// The day filter. ONE control, used by /admin/orders and
// /admin/subscriptions so the two boards cannot drift into asking the same
// question two different ways.
//
// It is deliberately small: a basis toggle and a date. It replaced a preset
// menu plus a From box plus a To box, which between them carried a reversed
// pair to swap, a half-filled pair to interpret, and a menu label that could
// contradict the boxes beneath it. None of that state has a successor here,
// because none of it was answering a question anyone asks on these boards.
//
// The semantics live in @/lib/day-filter; this file is only the surface.

import DatePicker from "@/components/ui/DatePicker";
import Select from "@/components/ui/Select";
import type { DateBasis } from "@/lib/day-filter";

const LABEL_STYLE: React.CSSProperties = {
  color: "rgba(251,243,212,0.7)",
  fontFamily: "var(--font-body)",
  fontSize: "0.75rem",
  letterSpacing: "0.15em",
  textTransform: "uppercase",
};

export type DayFilterProps = {
  basis: DateBasis;
  onBasisChange: (next: DateBasis) => void;
  /** null = no day selected = every row. */
  day: string | null;
  onDayChange: (next: string | null) => void;
  /** Prefix for the generated input ids. Two boards, two prefixes. */
  idPrefix: string;
};

export function DayFilter({
  basis,
  onBasisChange,
  day,
  onDayChange,
  idPrefix,
}: DayFilterProps) {
  return (
    <>
      {/* Which date-column the day applies to. The label stays visible
          rather than living in a tooltip: with a ~12h booking lead the
          delivering-today and placed-today sets barely intersect, so an
          operator who misreads which axis is in play is not looking at a
          slightly different list, they are looking at a different list. */}
      <div
        style={{
          display: "inline-flex",
          flexDirection: "column",
          gap: "0.25rem",
          flex: "1 1 170px",
          minWidth: 0,
        }}
      >
        <label htmlFor={`${idPrefix}-basis`} style={LABEL_STYLE}>
          Filter by
        </label>
        <div style={{ minWidth: 0 }}>
          <Select
            id={`${idPrefix}-basis`}
            value={basis}
            ariaLabel="Which date to filter on"
            onChange={(v) => onBasisChange(v as DateBasis)}
            options={[
              { value: "delivery", label: "Delivery date" },
              { value: "order", label: "Order date" },
            ]}
          />
        </div>
      </div>

      {/* The one date. `flex: 1 1 170px` rather than a fixed width so the
          pair wraps under itself on a phone instead of running off the
          right edge. */}
      <div
        style={{
          display: "inline-flex",
          flexDirection: "column",
          gap: "0.25rem",
          flex: "1 1 170px",
          minWidth: 0,
        }}
      >
        <label htmlFor={`${idPrefix}-day`} style={LABEL_STYLE}>
          Date
        </label>
        <div style={{ display: "flex", gap: "0.5rem", minWidth: 0 }}>
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <DatePicker
              id={`${idPrefix}-day`}
              value={day ?? ""}
              ariaLabel="Filter date"
              placeholder="All dates"
              onChange={(v) => onDayChange(v || null)}
            />
          </div>
          {/* Shown only when a day is set. DatePicker can select but never
              unselect — without this the operator's only way back to the
              whole board is editing the URL, which is not an affordance. */}
          {day ? (
            <button
              type="button"
              onClick={() => onDayChange(null)}
              className="uppercase"
              style={{
                flex: "0 0 auto",
                alignSelf: "stretch",
                padding: "0 0.75rem",
                border: "1px solid rgba(251,243,212,0.35)",
                background: "transparent",
                color: "#FBF3D4",
                fontFamily: "var(--font-body)",
                fontSize: "0.7rem",
                letterSpacing: "0.12em",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
