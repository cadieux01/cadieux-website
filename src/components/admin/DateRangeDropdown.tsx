"use client";

// Universal date-range control for the admin panel. A single compact
// dropdown of fixed presets; selecting "Custom" reveals inline From/To
// pickers. Replaces the older DateRangePicker (preset chips + URL state)
// everywhere so every admin page shares one look and behaviour.
//
// Contract:
//   • Returns a resolved { from: Date, to: Date } to the parent via
//     onChange. `from` is start-of-day (00:00:00.000), `to` is
//     end-of-day (23:59:59.999) so inclusive timestamp filtering is
//     natural.
//   • Default selection is "This Month". The component does NOT emit on
//     mount — parents seed their initial state with resolvePreset
//     ("this_month") so there's no flash or redundant fetch.
//
// Palette: Foundation Green (#024628) + Grain Cream (#FBF3D4).

import { useState } from "react";

import Select from "@/components/ui/Select";
import DatePicker from "@/components/ui/DatePicker";

const GREEN = "#024628";
const CREAM = "#fbf3d4";

export type DateRangeValue = { from: Date; to: Date };

export type PresetKey =
  | "today"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "last_6_months"
  | "one_year"
  | "custom";

type CustomMode = "range" | "single" | "year";

const CUSTOM_MODES: { key: CustomMode; label: string }[] = [
  { key: "range", label: "Range" },
  { key: "single", label: "Single date" },
  { key: "year", label: "Year" },
];

export const DEFAULT_PRESET: PresetKey = "this_month";

const PRESETS: { key: Exclude<PresetKey, "custom">; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "this_week", label: "This Week" },
  { key: "last_week", label: "Last Week" },
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "last_6_months", label: "Last 6 Months" },
  { key: "one_year", label: "1 Year" },
];

// ── date math (all local time) ───────────────────────────────────────────
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
// Monday as the first day of the week.
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const offset = (x.getDay() + 6) % 7; // Mon=0 … Sun=6
  return addDays(x, -offset);
}

// Resolve a preset (other than "custom") to a concrete Date range.
export function resolvePreset(key: Exclude<PresetKey, "custom">): DateRangeValue {
  const now = new Date();
  switch (key) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "this_week": {
      const s = startOfWeek(now);
      return { from: s, to: endOfDay(addDays(s, 6)) };
    }
    case "last_week": {
      const s = addDays(startOfWeek(now), -7);
      return { from: s, to: endOfDay(addDays(s, 6)) };
    }
    case "this_month": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { from: startOfDay(s), to: endOfDay(e) };
    }
    case "last_month": {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: startOfDay(s), to: endOfDay(e) };
    }
    case "last_6_months": {
      const s = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
      return { from: startOfDay(s), to: endOfDay(now) };
    }
    case "one_year": {
      const s = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      return { from: startOfDay(s), to: endOfDay(now) };
    }
  }
}

// Parse a YYYY-MM-DD string (from a <input type="date">) as local midnight.
function parseYmd(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

// ── exported helpers for consuming pages ─────────────────────────────────

/** YYYY-MM-DD in local time (for API params that expect date-only). */
export function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Inclusive membership test for client-side row filtering. */
export function withinDateRange(
  iso: string | null | undefined,
  range: DateRangeValue | null,
): boolean {
  if (!range) return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= range.from.getTime() && t <= range.to.getTime();
}

// ── component ─────────────────────────────────────────────────────────────
export function DateRangeDropdown({
  onChange,
  initialPreset = DEFAULT_PRESET,
}: {
  onChange: (range: DateRangeValue) => void;
  initialPreset?: PresetKey;
}) {
  const [preset, setPreset] = useState<PresetKey>(initialPreset);
  const [customMode, setCustomMode] = useState<CustomMode>("range");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [singleDate, setSingleDate] = useState("");
  const [yearValue, setYearValue] = useState<string>(String(new Date().getFullYear()));
  const [customError, setCustomError] = useState<string | null>(null);

  function selectPreset(next: PresetKey) {
    setPreset(next);
    setCustomError(null);
    if (next !== "custom") {
      onChange(resolvePreset(next));
    }
    // When entering "custom", wait for Apply — do NOT emit on select.
  }

  function switchCustomMode(next: CustomMode) {
    setCustomMode(next);
    setCustomError(null);
  }

  function applyCustom() {
    setCustomError(null);
    if (customMode === "range") {
      const f = parseYmd(customFrom);
      const t = parseYmd(customTo);
      if (!f || !t) {
        setCustomError("Pick both From and To dates.");
        return;
      }
      // Swap on reversed input so the API always gets from ≤ to.
      const earlier = f.getTime() <= t.getTime() ? f : t;
      const later = f.getTime() <= t.getTime() ? t : f;
      onChange({ from: startOfDay(earlier), to: endOfDay(later) });
      return;
    }
    if (customMode === "single") {
      const d = parseYmd(singleDate);
      if (!d) {
        setCustomError("Pick a date.");
        return;
      }
      onChange({ from: startOfDay(d), to: endOfDay(d) });
      return;
    }
    // year
    const y = Number(yearValue);
    if (!Number.isInteger(y) || y < 1900 || y > 3000) {
      setCustomError("Pick a valid year.");
      return;
    }
    const from = startOfDay(new Date(y, 0, 1));
    const to = endOfDay(new Date(y, 11, 31));
    onChange({ from, to });
  }

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: "0.5rem" }}>
      <div style={{ minWidth: 190 }}>
        <Select
          ariaLabel="Date range"
          value={preset}
          onChange={(v) => selectPreset(v as PresetKey)}
          style={{ background: GREEN, borderColor: GREEN, minHeight: 0 }}
          options={[
            ...PRESETS.map((p) => ({ value: p.key, label: p.label })),
            { value: "custom", label: "Custom…" },
          ]}
        />
      </div>

      {preset === "custom" ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            padding: "0.6rem",
            background: GREEN,
            border: `1px solid ${CREAM}33`,
            borderRadius: 6,
          }}
        >
          {/* Mode chips */}
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
            {CUSTOM_MODES.map((m) => {
              const active = customMode === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => switchCustomMode(m.key)}
                  aria-pressed={active}
                  style={{
                    background: active ? CREAM : "transparent",
                    color: active ? GREEN : CREAM,
                    border: `1px solid ${CREAM}`,
                    borderRadius: 4,
                    padding: "0.25rem 0.6rem",
                    fontSize: "0.875rem",
                    cursor: "pointer",
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          {/* Inputs per mode */}
          {customMode === "range" ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <div style={{ minWidth: 170 }}>
                <DatePicker
                  value={customFrom}
                  ariaLabel="From date"
                  placeholder="From…"
                  onChange={(v) => setCustomFrom(v)}
                  style={{ minHeight: 0, fontSize: "1rem" }}
                />
              </div>
              <span style={{ color: CREAM, opacity: 0.6 }}>—</span>
              <div style={{ minWidth: 170 }}>
                <DatePicker
                  value={customTo}
                  ariaLabel="To date"
                  placeholder="To…"
                  onChange={(v) => setCustomTo(v)}
                  style={{ minHeight: 0, fontSize: "1rem" }}
                />
              </div>
            </div>
          ) : null}

          {customMode === "single" ? (
            <div style={{ minWidth: 170 }}>
              <DatePicker
                value={singleDate}
                ariaLabel="Date"
                placeholder="Pick a date…"
                onChange={(v) => setSingleDate(v)}
                style={{ minHeight: 0, fontSize: "1rem" }}
              />
            </div>
          ) : null}

          {customMode === "year" ? (
            <div style={{ minWidth: 120 }}>
              <input
                type="number"
                inputMode="numeric"
                min={1900}
                max={3000}
                step={1}
                value={yearValue}
                onChange={(e) => setYearValue(e.target.value)}
                aria-label="Year"
                style={{
                  background: CREAM,
                  color: GREEN,
                  border: `1px solid ${CREAM}`,
                  borderRadius: 4,
                  padding: "0.3rem 0.5rem",
                  fontSize: "1rem",
                  width: 120,
                }}
              />
            </div>
          ) : null}

          {/* Apply + inline error */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={applyCustom}
              style={{
                background: CREAM,
                color: GREEN,
                border: `1px solid ${CREAM}`,
                borderRadius: 4,
                padding: "0.35rem 0.9rem",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Apply
            </button>
            {customError ? (
              <span style={{ color: CREAM, fontSize: "1rem", opacity: 0.85 }}>
                {customError}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
