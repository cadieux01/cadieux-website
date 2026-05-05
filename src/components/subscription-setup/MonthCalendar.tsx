"use client";

// iOS-Calendar-style month grid where the user picks whole WEEKS by tapping
// any date in a row. A continuous gold pill spans Sun→Sat to indicate a
// selected week. Navigation is limited to current month + the next two months.

import { useMemo, useState } from "react";
import { isoDate, sundayOf } from "@/lib/subscription-setup";

const GOLD = "#c9a96e";
const TEXT = "#FBF3D4";
const FADED = "rgba(240,223,200,0.6)";
const FAINT = "rgba(240,223,200,0.12)";
const CHARCOAL = "#0d0d0d";

type Cell = {
  date: Date;
  iso: string;
  weekSundayIso: string;
  inMonth: boolean;
  isPast: boolean;
  isToday: boolean;
};

type Row = {
  weekSundayIso: string;
  cells: Cell[]; // length 7, Sun..Sat
};

function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Build six rows (42 cells) starting from the Sunday on/before the 1st of (y,m). */
function buildMonthRows(y: number, m: number, today: Date): Row[] {
  const first = new Date(y, m, 1);
  const gridStart = sundayOf(first);
  const rows: Row[] = [];
  for (let r = 0; r < 6; r++) {
    const cells: Cell[] = [];
    let weekSundayIso = "";
    for (let c = 0; c < 7; c++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + r * 7 + c);
      const iso = isoDate(d);
      if (c === 0) weekSundayIso = iso;
      cells.push({
        date: d,
        iso,
        weekSundayIso,
        inMonth: d.getMonth() === m,
        isPast: d < today,
        isToday: d.getTime() === today.getTime(),
      });
    }
    rows.push({ weekSundayIso, cells });
  }
  return rows;
}

const MONTH_LABELS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthCalendar({
  selectedWeeks,
  onToggleWeek,
}: {
  selectedWeeks: string[];
  onToggleWeek: (weekSundayIso: string) => void;
}) {
  const today = useMemo(() => atMidnight(new Date()), []);
  const baseY = today.getFullYear();
  const baseM = today.getMonth();
  const [offset, setOffset] = useState(0);

  // Current view month (offset 0..2)
  const viewDate = new Date(baseY, baseM + offset, 1);
  const viewY = viewDate.getFullYear();
  const viewM = viewDate.getMonth();

  const rows = useMemo(
    () => buildMonthRows(viewY, viewM, today),
    [viewY, viewM, today]
  );

  // Selected if any row's Sunday matches an entry in selectedWeeks.
  const selectedSet = useMemo(() => new Set(selectedWeeks), [selectedWeeks]);

  const canPrev = offset > 0;
  const canNext = offset < 2;

  function handleCellTap(cell: Cell) {
    if (cell.isPast) return;
    onToggleWeek(cell.weekSundayIso);
  }

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: `1px solid ${FAINT}`,
        borderRadius: 16,
        padding: 16,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <NavArrow
          dir="prev"
          disabled={!canPrev}
          onClick={() => canPrev && setOffset(offset - 1)}
        />
        <div
          key={`${viewY}-${viewM}`}
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 300,
            fontSize: 22,
            letterSpacing: "0.02em",
            color: TEXT,
            animation: "cdx-fade-in 0.22s ease",
          }}
        >
          {MONTH_LABELS[viewM]} {viewY}
        </div>
        <NavArrow
          dir="next"
          disabled={!canNext}
          onClick={() => canNext && setOffset(offset + 1)}
        />
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 0,
          marginBottom: 6,
        }}
      >
        {DOW_LABELS.map((d) => (
          <div
            key={d}
            style={{
              textAlign: "center",
              fontSize: 11,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: FADED,
              padding: "6px 0",
              fontFamily: "var(--font-body)",
            }}
          >
            {d}
          </div>
        ))}
      </div>

      <div
        key={`${viewY}-${viewM}-grid`}
        style={{
          display: "grid",
          gridAutoRows: "minmax(44px, auto)",
          gap: 4,
          animation: "cdx-fade-in 0.22s ease",
        }}
      >
        {rows.map((row) => {
          const selected = selectedSet.has(row.weekSundayIso);
          return (
            <div
              key={row.weekSundayIso}
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: 0,
              }}
            >
              {row.cells.map((cell, idx) => {
                const isFirst = idx === 0;
                const isLast = idx === 6;
                const radius = selected
                  ? isFirst
                    ? "999px 0 0 999px"
                    : isLast
                    ? "0 999px 999px 0"
                    : "0"
                  : "10px";
                const bg = selected ? GOLD : "transparent";
                const fg = selected
                  ? cell.isPast
                    ? "rgba(13,13,13,0.35)"
                    : CHARCOAL
                  : cell.isPast
                  ? "rgba(240,223,200,0.22)"
                  : cell.inMonth
                  ? TEXT
                  : "rgba(240,223,200,0.35)";
                return (
                  <button
                    key={cell.iso}
                    onClick={() => handleCellTap(cell)}
                    disabled={cell.isPast}
                    aria-pressed={selected}
                    aria-label={`${cell.date.toDateString()}${selected ? " (selected week)" : ""}`}
                    style={{
                      minHeight: 44,
                      minWidth: 0,
                      padding: 0,
                      border: "none",
                      background: bg,
                      color: fg,
                      cursor: cell.isPast ? "not-allowed" : "pointer",
                      borderRadius: radius,
                      fontFamily: "var(--font-body)",
                      fontSize: 15,
                      fontWeight: cell.isToday ? 600 : 400,
                      position: "relative",
                      transition: "background 0.18s ease, color 0.18s ease",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {cell.isToday && !selected && (
                      <span
                        aria-hidden
                        style={{
                          position: "absolute",
                          inset: 4,
                          borderRadius: 999,
                          border: `1.5px solid ${GOLD}`,
                          pointerEvents: "none",
                        }}
                      />
                    )}
                    <span style={{ position: "relative", zIndex: 1 }}>
                      {cell.date.getDate()}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes cdx-fade-in {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function NavArrow({
  dir,
  disabled,
  onClick,
}: {
  dir: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "Previous month" : "Next month"}
      style={{
        width: 36,
        height: 36,
        borderRadius: 999,
        background: "transparent",
        border: `1px solid ${disabled ? FAINT : "rgba(240,223,200,0.25)"}`,
        color: disabled ? FAINT : GOLD,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 18,
        lineHeight: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {dir === "prev" ? "‹" : "›"}
    </button>
  );
}
