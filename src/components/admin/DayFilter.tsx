"use client";

// The day filter. ONE control, used by /admin/orders and
// /admin/subscriptions so the two boards cannot drift into asking the same
// question two different ways. /admin/deliveries is NOT a caller — see the
// note below the header.
//
// It is deliberately small: a basis toggle and a date. It replaced a preset
// menu plus a From box plus a To box, which between them carried a reversed
// pair to swap, a half-filled pair to interpret, and a menu label that could
// contradict the boxes beneath it. None of that state has a successor here,
// because none of it was answering a question anyone asks on these boards.
//
// The semantics live in @/lib/day-filter; this file is only the surface.
//
// IT IS ONE DAY AGAIN. This file briefly carried an opt-in range: a "Span"
// dropdown plus From and To fields, rendered only for the caller that wired
// `mode`/`onModeChange`/`range`/`onRangeChange`. Exactly one board ever did —
// /admin/deliveries — and it now uses DateSpanPicker, which infers one date
// or two from the taps and needs no dropdown to be set first. The props are
// deleted rather than left unused: an opt-in with no callers is an invitation
// to re-add the control this component's header explains was removed.
//
// Do not put a range back here. The range question belongs to the routing
// board, DateSpanPicker answers it there, and the paragraph above is what
// happens when this file tries to answer both.
//
// THE PRESET BUTTONS ARE NOT THAT RANGE COMING BACK. What was deleted above
// was a dropdown PLUS two typed fields: three inputs that could contradict
// each other. What is here now is two buttons, each naming one window, and
// the name is the whole of the input — there is nothing for the label to
// disagree with. See the "Duration presets" block in @/lib/day-filter for
// the four ambiguities and why a named window pays none of them.
// They are opt-in via `onSpanChange`, so the kitchen sheet never gets them.

import DatePicker from "@/components/ui/DatePicker";
import Select from "@/components/ui/Select";
import type { DateBasis, DurationPreset } from "@/lib/day-filter";
import { spanLabel } from "@/lib/day-filter";

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
  // ── Span: OPT-IN, by passing onSpanChange ──────────────────────────────
  // A whole period is a question you ask of a board you are READING. The
  // packing list and the run sheet are read while packing one day's crates,
  // and a sheet that can span days is how the print view once listed 60
  // orders against a screen showing 9. They do not pass these.
  span?: DurationPreset | null;
  onSpanChange?: (next: DurationPreset | null) => void;
  /** Prefix for the generated input ids. Two boards, two prefixes. */
  idPrefix: string;
};

const PRESETS: readonly DurationPreset[] = ["week", "month"];

export function DayFilter({
  basis,
  onBasisChange,
  day,
  onDayChange,
  span = null,
  onSpanChange,
  idPrefix,
}: DayFilterProps) {
  const basisEnabled = Boolean(basis && onBasisChange);
  const spansEnabled = Boolean(onSpanChange);

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

      {/* The date. `flex: 1 1 170px` rather than a fixed width so the
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
        <label htmlFor={`${idPrefix}-day`} style={LABEL_STYLE}>
          Date
        </label>
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            minWidth: 0,
            flexWrap: "wrap",
          }}
        >
          {/* The placeholder changes with the span because "All dates" is a
              lie while a preset is narrowing the board, and this empty box
              is the only thing an operator can read as "no filter". */}
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <DatePicker
              id={`${idPrefix}-day`}
              value={day ?? ""}
              ariaLabel="Filter date"
              placeholder={span ? "Pick a date" : "All dates"}
              onChange={(v) => onDayChange(v || null)}
            />
          </div>

          {/* Shown when a day OR a span is set. DatePicker can select but
              never unselect — without this the operator's only way back to
              the whole board is editing the URL, which is not an
              affordance. It clears BOTH: one button, one meaning ("show me
              everything"), whichever control got us here. */}
          {day || span ? (
            <button
              type="button"
              onClick={() => {
                onSpanChange?.(null);
                onDayChange(null);
              }}
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

      {/* Whole periods. Rendered only for boards that opted in.
          `aria-pressed` rather than a radio group because the pair is not
          exhaustive — neither pressed is a real, reachable state (no filter)
          and is in fact the default. Tapping the pressed one releases it.

          MUTUAL EXCLUSION IS THE BOARD'S JOB, NOT THIS FILE'S. A day and a
          span must never both be live, but if this button called BOTH
          callbacks the two state updates would race on their order: the
          board's day handler clears the span, so `onSpanChange(p)` followed
          by `onDayChange(null)` would set the span and then immediately
          unset it. Each callback here sets exactly one thing; `applySpan` /
          `applyDay` on the board clear the other. The Clear button below is
          the one exception, and it is safe because both targets are null. */}
      {spansEnabled ? (
        <div
          style={{
            display: "inline-flex",
            flexDirection: "column",
            gap: "0.25rem",
            flex: "0 0 auto",
            minWidth: 0,
          }}
        >
          <span style={LABEL_STYLE}>Period</span>
          <div
            role="group"
            aria-label="Filter by a whole period"
            style={{ display: "flex", gap: "0.5rem" }}
          >
            {PRESETS.map((p) => {
              const on = span === p;
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSpanChange?.(on ? null : p)}
                  className="uppercase"
                  style={{
                    flex: "0 0 auto",
                    padding: "0.55rem 0.75rem",
                    border: on
                      ? "1px solid #FBF3D4"
                      : "1px solid rgba(251,243,212,0.35)",
                    background: on ? "rgba(251,243,212,0.14)" : "transparent",
                    color: "#FBF3D4",
                    fontFamily: "var(--font-body)",
                    fontSize: "0.7rem",
                    letterSpacing: "0.12em",
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                  }}
                >
                  {spanLabel(p)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
