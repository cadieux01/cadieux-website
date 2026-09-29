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
  // ── Basis: OPT-OUT, by omitting the pair ───────────────────────────────
  // Orders and subscriptions both have two date axes to choose between and
  // pass these, so they are unchanged. The partner deliveries board has
  // ONE: a subscription's days come from its delivery stops and it has no
  // order-date axis at all, so offering the choice there would render a
  // control that either does nothing or answers with the wrong column.
  basis?: DateBasis;
  onBasisChange?: (next: DateBasis) => void;
  /** null = no day selected = every row. */
  day: string | null;
  onDayChange: (next: string | null) => void;
  /** Prefix for the generated input ids. Two boards, two prefixes. */
  idPrefix: string;

  // ── Range mode: OPT-IN, and off unless a caller wires all three ────────
  // Omit these and this component renders byte-for-byte what it rendered
  // before range existed. That is deliberate: the file header explains why
  // From+To was taken off the orders and subscriptions boards, and neither
  // of them passes these props, so neither gets it back. The partner
  // deliveries board asks a genuinely multi-day question and opts in.
  /** Current mode. Undefined = single day, and no toggle is rendered. */
  mode?: "day" | "range";
  onModeChange?: (next: "day" | "range") => void;
  /** The range ends. Only read when `mode === "range"`. An open end means
   *  unbounded on that side — see normaliseRange in @/lib/day-filter. */
  range?: { from: string | null; to: string | null };
  onRangeChange?: (next: { from: string | null; to: string | null }) => void;

  /** Render the inline Clear. Default true — orders and subscriptions rely
   *  on it, and without it DatePicker can select but never unselect.
   *  A host that owns its own Clear passes false: two buttons both reading
   *  CLEAR, one emptying the field and one applying it, is worse than
   *  either alone. */
  showClear?: boolean;
};

export function DayFilter({
  basis,
  onBasisChange,
  day,
  onDayChange,
  idPrefix,
  mode,
  onModeChange,
  range,
  onRangeChange,
  showClear = true,
}: DayFilterProps) {
  // The toggle appears only when the caller can actually handle both modes.
  // Rendering it without `onModeChange` would give the operator a control
  // that silently does nothing.
  const rangeEnabled = Boolean(onModeChange && onRangeChange);
  const isRange = rangeEnabled && mode === "range";
  const basisEnabled = Boolean(basis && onBasisChange);

  return (
    <>
      {/* Which date-column the day applies to. The label stays visible
          rather than living in a tooltip: with a ~12h booking lead the
          delivering-today and placed-today sets barely intersect, so an
          operator who misreads which axis is in play is not looking at a
          slightly different list, they are looking at a different list. */}
      {basisEnabled ? (
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
              value={basis as DateBasis}
              ariaLabel="Which date to filter on"
              onChange={(v) => onBasisChange?.(v as DateBasis)}
              options={[
                { value: "delivery", label: "Delivery date" },
                { value: "order", label: "Order date" },
              ]}
            />
          </div>
        </div>
      ) : null}

      {/* Single / Range. Rendered only for callers that opted in. */}
      {rangeEnabled ? (
        <div
          style={{
            display: "inline-flex",
            flexDirection: "column",
            gap: "0.25rem",
            flex: "1 1 140px",
            minWidth: 0,
          }}
        >
          <label htmlFor={`${idPrefix}-mode`} style={LABEL_STYLE}>
            Span
          </label>
          <div style={{ minWidth: 0 }}>
            <Select
              id={`${idPrefix}-mode`}
              value={isRange ? "range" : "day"}
              ariaLabel="Single day or a date range"
              onChange={(v) => onModeChange?.(v === "range" ? "range" : "day")}
              options={[
                { value: "day", label: "Single day" },
                { value: "range", label: "Date range" },
              ]}
            />
          </div>
        </div>
      ) : null}

      {/* The date(s). `flex: 1 1 170px` rather than a fixed width so the
          controls wrap under each other on a phone instead of running off
          the right edge. */}
      <div
        style={{
          display: "inline-flex",
          flexDirection: "column",
          gap: "0.25rem",
          flex: "1 1 170px",
          minWidth: 0,
        }}
      >
        <label htmlFor={isRange ? `${idPrefix}-from` : `${idPrefix}-day`} style={LABEL_STYLE}>
          {isRange ? "From / To" : "Date"}
        </label>
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            minWidth: 0,
            flexWrap: "wrap",
          }}
        >
          {isRange ? (
            <>
              {/* Both ends are always rendered, and either may be left
                  empty. An empty end is unbounded on that side — it is not
                  an incomplete entry to be nagged about. */}
              <div style={{ flex: "1 1 130px", minWidth: 0 }}>
                <DatePicker
                  id={`${idPrefix}-from`}
                  value={range?.from ?? ""}
                  ariaLabel="Range start date"
                  placeholder="From (any)"
                  onChange={(v) =>
                    onRangeChange?.({
                      from: v || null,
                      to: range?.to ?? null,
                    })
                  }
                />
              </div>
              <div style={{ flex: "1 1 130px", minWidth: 0 }}>
                <DatePicker
                  id={`${idPrefix}-to`}
                  value={range?.to ?? ""}
                  ariaLabel="Range end date"
                  placeholder="To (any)"
                  onChange={(v) =>
                    onRangeChange?.({
                      from: range?.from ?? null,
                      to: v || null,
                    })
                  }
                />
              </div>
            </>
          ) : (
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <DatePicker
                id={`${idPrefix}-day`}
                value={day ?? ""}
                ariaLabel="Filter date"
                placeholder="All dates"
                onChange={(v) => onDayChange(v || null)}
              />
            </div>
          )}

          {/* Shown only when something is set. DatePicker can select but
              never unselect — without this the operator's only way back to
              the whole board is editing the URL, which is not an
              affordance. In range mode it clears BOTH ends, because
              clearing one and leaving the other is still a filter. */}
          {showClear &&
          (isRange ? Boolean(range?.from || range?.to) : Boolean(day)) ? (
            <button
              type="button"
              onClick={() =>
                isRange
                  ? onRangeChange?.({ from: null, to: null })
                  : onDayChange(null)
              }
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
