"use client";

// iOS-Calendar-style month grid where each date is independently
// selectable. Header has prev/next month arrows and a tappable month label
// that opens a 3-month picker overlay (current month + next two).
// A bill bar at the bottom shows the live N × price × qty total.

import { useMemo, useState } from "react";
import { isoDate } from "@/lib/subscription-setup";
import { dateHasAnyBookable } from "@/lib/delivery-slots";

const GOLD = "#024628";
const TEXT = "#024628";
const FADED = "rgba(2,70,40,0.6)";
const FAINT = "rgba(2,70,40,0.2)";
const CHARCOAL = "#FBF3D4";
const WALNUT = "#024628";

type Cell = {
  date: Date;
  iso: string;
  inMonth: boolean;
  isPast: boolean;
  isToday: boolean;
  noSlots: boolean;
};

function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Build six rows (42 cells) starting from the Sunday on/before the 1st of (y,m). */
function buildMonthCells(y: number, m: number, today: Date, now: Date): Cell[][] {
  const first = new Date(y, m, 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  const rows: Cell[][] = [];
  for (let r = 0; r < 6; r++) {
    const cells: Cell[] = [];
    for (let c = 0; c < 7; c++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + r * 7 + c);
      const iso = isoDate(d);
      const isPast = d < today;
      // A future date always has at least one bookable slot (>12h10m
      // away); today is the only date that can go fully-blocked once
      // enough of the day has passed. Skip the check on past dates.
      const noSlots = !isPast && !dateHasAnyBookable(iso, now);
      cells.push({
        date: d,
        iso,
        inMonth: d.getMonth() === m,
        isPast,
        isToday: d.getTime() === today.getTime(),
        noSlots,
      });
    }
    rows.push(cells);
  }
  return rows;
}

const MONTH_LABELS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const MONTH_SHORT = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function DateCalendar({
  selectedDates,
  onToggleDate,
  deliveriesCount,
  totalAmount,
}: {
  selectedDates: string[];
  onToggleDate: (iso: string) => void;
  deliveriesCount: number;
  totalAmount: number;
}) {
  const now = useMemo(() => new Date(), []);
  const today = useMemo(() => atMidnight(now), [now]);
  const baseY = today.getFullYear();
  const baseM = today.getMonth();
  const [offset, setOffset] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);

  const viewDate = new Date(baseY, baseM + offset, 1);
  const viewY = viewDate.getFullYear();
  const viewM = viewDate.getMonth();

  const rows = useMemo(
    () => buildMonthCells(viewY, viewM, today, now),
    [viewY, viewM, today, now]
  );
  const selectedSet = useMemo(() => new Set(selectedDates), [selectedDates]);

  const canPrev = offset > 0;
  const canNext = offset < 2;

  return (
    <div
      style={{
        position: "relative",
        background: "transparent",
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
        <button
          onClick={() => setPickerOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={pickerOpen}
          style={{
            background: "transparent",
            border: "none",
            color: TEXT,
            cursor: "pointer",
            fontFamily: "var(--font-heading)",
            fontWeight: 300,
            fontSize: 22,
            letterSpacing: "0.02em",
            padding: "4px 12px",
            borderRadius: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            key={`${viewY}-${viewM}-label`}
            style={{ animation: "cdx-fade-in 0.22s ease" }}
          >
            {MONTH_LABELS[viewM]} {viewY}
          </span>
          <span aria-hidden style={{ fontSize: 12, color: GOLD, transform: pickerOpen ? "rotate(180deg)" : "none", transition: "transform 0.18s ease" }}>▾</span>
        </button>
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
              color: GOLD,
              opacity: 0.75,
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
          gridTemplateColumns: "repeat(7, 1fr)",
          gridAutoRows: "minmax(44px, auto)",
          gap: 4,
          animation: "cdx-fade-in 0.22s ease",
        }}
      >
        {rows.flat().map((cell) => {
          const selected = selectedSet.has(cell.iso);
          const blocked = cell.isPast || cell.noSlots;
          const fg = selected
            ? CHARCOAL
            : blocked
            ? "rgba(2,70,40,0.3)"
            : cell.inMonth
            ? TEXT
            : "rgba(2,70,40,0.4)";
          return (
            <button
              key={cell.iso}
              onClick={() => !blocked && onToggleDate(cell.iso)}
              disabled={blocked}
              aria-pressed={selected}
              aria-label={`${cell.date.toDateString()}${
                cell.noSlots ? " (no delivery slots left today — please pick another date)" : ""
              }${selected ? " (selected)" : ""}`}
              title={
                cell.noSlots
                  ? "We bake fresh — pick a date at least 12 hours from now."
                  : undefined
              }
              style={{
                minHeight: 44,
                minWidth: 0,
                padding: 0,
                border: "none",
                background: selected ? GOLD : "transparent",
                color: fg,
                cursor: blocked ? "not-allowed" : "pointer",
                borderRadius: 999,
                fontFamily: "var(--font-body)",
                fontSize: 15,
                fontWeight: cell.isToday ? 600 : 400,
                position: "relative",
                transition: "background 0.15s ease, color 0.15s ease",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {cell.isToday && !selected && !cell.noSlots && (
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

      <BillBar count={deliveriesCount} total={totalAmount} />

      {pickerOpen && (
        <MonthPickerOverlay
          baseY={baseY}
          baseM={baseM}
          activeOffset={offset}
          onPick={(o) => {
            setOffset(o);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <style>{`
        @keyframes cdx-fade-in {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes cdx-overlay-in {
          from { opacity: 0; transform: scale(0.98); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

function BillBar({ count, total }: { count: number; total: number }) {
  return (
    <div
      style={{
        marginTop: 16,
        padding: "14px 18px",
        borderRadius: 14,
        background: WALNUT,
        border: `1px solid rgba(251,243,212,0.25)`,
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 300,
            fontSize: 28,
            color: "#FBF3D4",
            lineHeight: 1,
          }}
        >
          {count}
        </span>
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 12,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "rgba(251,243,212,0.7)",
          }}
        >
          {count === 1 ? "delivery" : "deliveries"}
        </span>
      </div>
      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontWeight: 300,
          fontSize: 22,
          color: "#FBF3D4",
        }}
      >
        ₹{total.toLocaleString("en-IN")}
      </div>
    </div>
  );
}

function MonthPickerOverlay({
  baseY,
  baseM,
  activeOffset,
  onPick,
  onClose,
}: {
  baseY: number;
  baseM: number;
  activeOffset: number;
  onPick: (offset: number) => void;
  onClose: () => void;
}) {
  const months = [0, 1, 2].map((o) => {
    const d = new Date(baseY, baseM + o, 1);
    return { offset: o, y: d.getFullYear(), m: d.getMonth() };
  });
  return (
    <div
      role="menu"
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(192,200,206,0.92)",
        backdropFilter: "blur(6px)",
        borderRadius: 16,
        zIndex: 5,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        animation: "cdx-overlay-in 0.18s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
          width: "100%",
          maxWidth: 360,
        }}
      >
        {months.map((mo) => {
          const active = mo.offset === activeOffset;
          return (
            <button
              key={mo.offset}
              onClick={() => onPick(mo.offset)}
              style={{
                padding: "18px 10px",
                borderRadius: 12,
                border: `1px solid ${active ? GOLD : FAINT}`,
                background: active ? "rgba(2,70,40,0.14)" : "transparent",
                color: TEXT,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-heading)",
                  fontWeight: 300,
                  fontSize: 22,
                  color: active ? GOLD : TEXT,
                }}
              >
                {MONTH_SHORT[mo.m]}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 11,
                  letterSpacing: "0.1em",
                  color: FADED,
                }}
              >
                {mo.y}
              </span>
            </button>
          );
        })}
      </div>
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
        border: `1px solid ${disabled ? FAINT : "rgba(2,70,40,0.35)"}`,
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
