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
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  function selectPreset(next: PresetKey) {
    setPreset(next);
    if (next !== "custom") {
      onChange(resolvePreset(next));
    } else {
      // Re-emit immediately if both custom dates are already filled.
      emitCustom(customFrom, customTo);
    }
  }

  function emitCustom(fromStr: string, toStr: string) {
    const f = parseYmd(fromStr);
    const t = parseYmd(toStr);
    if (f && t) {
      const from = startOfDay(f);
      const to = endOfDay(t);
      // Guard against reversed ranges.
      if (from.getTime() <= to.getTime()) onChange({ from, to });
    }
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
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <div style={{ minWidth: 170 }}>
            <DatePicker
              value={customFrom}
              ariaLabel="From date"
              placeholder="From…"
              onChange={(v) => {
                setCustomFrom(v);
                emitCustom(v, customTo);
              }}
              style={{ minHeight: 0, fontSize: "0.85rem" }}
            />
          </div>
          <span style={{ color: CREAM, opacity: 0.6 }}>—</span>
          <div style={{ minWidth: 170 }}>
            <DatePicker
              value={customTo}
              ariaLabel="To date"
              placeholder="To…"
              onChange={(v) => {
                setCustomTo(v);
                emitCustom(customFrom, v);
              }}
              style={{ minHeight: 0, fontSize: "0.85rem" }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
