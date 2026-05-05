"use client";

// One Sun..Sat strip per selected week. Each day is a tappable card with a
// stacked label/number. Past days are disabled. Selected days are filled
// gold; unselected are outlined.

import { useMemo } from "react";
import {
  daysInWeekSunday,
  isoDate,
  weekRangeLabelSunday,
} from "@/lib/subscription-setup";

const GOLD = "#c9a96e";
const TEXT = "#FBF3D4";
const FADED = "rgba(240,223,200,0.6)";
const FAINT = "rgba(240,223,200,0.12)";
const CHARCOAL = "#0d0d0d";

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function WeekDayStrip({
  weekSundayIso,
  pickedDates,
  onTogglePick,
}: {
  weekSundayIso: string;
  pickedDates: string[];
  onTogglePick: (dateIso: string) => void;
}) {
  const today = useMemo(() => atMidnight(new Date()), []);
  const days = useMemo(() => daysInWeekSunday(weekSundayIso), [weekSundayIso]);
  const pickedSet = useMemo(() => new Set(pickedDates), [pickedDates]);

  return (
    <div
      style={{
        padding: 18,
        borderRadius: 16,
        background: "rgba(255,255,255,0.03)",
        border: `1px solid ${FAINT}`,
        animation: "cdx-strip-fade 0.28s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 300,
            fontSize: 19,
            letterSpacing: "0.02em",
          }}
        >
          Week of {weekRangeLabelSunday(weekSundayIso)}
        </div>
        <div style={{ fontSize: 12, color: FADED }}>
          {pickedDates.length} {pickedDates.length === 1 ? "day" : "days"}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gap: 6,
        }}
      >
        {days.map((d, i) => {
          const iso = isoDate(d);
          const past = d < today;
          const selected = pickedSet.has(iso);
          return (
            <button
              key={iso}
              onClick={() => !past && onTogglePick(iso)}
              disabled={past}
              aria-pressed={selected}
              aria-label={d.toDateString()}
              style={{
                padding: "10px 0 12px",
                minHeight: 64,
                borderRadius: 12,
                border: `1px solid ${selected ? GOLD : past ? FAINT : "rgba(240,223,200,0.22)"}`,
                background: selected ? GOLD : "transparent",
                color: selected ? CHARCOAL : past ? "rgba(240,223,200,0.25)" : TEXT,
                cursor: past ? "not-allowed" : "pointer",
                opacity: past ? 0.6 : 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                transition: "background 0.18s ease, color 0.18s ease, border-color 0.18s ease",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: selected ? "rgba(13,13,13,0.7)" : FADED,
                }}
              >
                {DOW_LABELS[i]}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-heading)",
                  fontWeight: 400,
                  fontSize: 22,
                  lineHeight: 1,
                }}
              >
                {d.getDate()}
              </span>
            </button>
          );
        })}
      </div>

      {pickedDates.length === 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: "rgba(255,129,129,0.75)" }}>
          Pick at least one delivery day for this week
        </div>
      )}

      <style>{`
        @keyframes cdx-strip-fade {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
