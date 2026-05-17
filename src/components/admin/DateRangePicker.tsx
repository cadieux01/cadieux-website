"use client";

// Self-contained date-range filter with presets + custom dates. Writes
// the active range to ?from=YYYY-MM-DD&to=YYYY-MM-DD on the current
// route so links and refreshes preserve the operator's filter.
//
// The actual row filtering happens in the consuming page — this
// component only owns presentation + URL state. Each page passes a
// `value` (start/end ISO dates or null) and an `onChange` handler.

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { addDaysISO, isoLocalDate } from "@/lib/admin-formatting";

export type DateRange = {
  from: string | null;
  to: string | null;
};

type PresetKey =
  | "all"
  | "today"
  | "yesterday"
  | "last_7"
  | "last_30"
  | "this_month";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last_7", label: "Last 7 days" },
  { key: "last_30", label: "Last 30 days" },
  { key: "this_month", label: "This month" },
];

function rangeForPreset(key: PresetKey): DateRange {
  const today = isoLocalDate(new Date());
  switch (key) {
    case "all":
      return { from: null, to: null };
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDaysISO(today, -1);
      return { from: y, to: y };
    }
    case "last_7":
      return { from: addDaysISO(today, -6), to: today };
    case "last_30":
      return { from: addDaysISO(today, -29), to: today };
    case "this_month": {
      const now = new Date();
      const first = isoLocalDate(
        new Date(now.getFullYear(), now.getMonth(), 1),
      );
      return { from: first, to: today };
    }
  }
}

export function useDateRangeFromQuery(): DateRange {
  const params = useSearchParams();
  return useMemo(() => {
    const from = params.get("from");
    const to = params.get("to");
    return {
      from: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null,
      to: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : null,
    };
  }, [params]);
}

// Returns true when `createdAt` (ISO timestamp) falls within
// [range.from, range.to] inclusive (range bounds are date-only).
export function withinRange(createdAt: string | null, range: DateRange): boolean {
  if (!range.from && !range.to) return true;
  if (!createdAt) return false;
  const day = createdAt.slice(0, 10);
  if (range.from && day < range.from) return false;
  if (range.to && day > range.to) return false;
  return true;
}

export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange?: (next: DateRange) => void;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const apply = useCallback(
    (next: DateRange) => {
      const sp = new URLSearchParams(params.toString());
      if (next.from) sp.set("from", next.from);
      else sp.delete("from");
      if (next.to) sp.set("to", next.to);
      else sp.delete("to");
      const qs = sp.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
      onChange?.(next);
    },
    [params, router, onChange],
  );

  const activePreset = useMemo<PresetKey | null>(() => {
    for (const p of PRESETS) {
      const r = rangeForPreset(p.key);
      if (r.from === value.from && r.to === value.to) return p.key;
    }
    return null;
  }, [value]);

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",
        alignItems: "center",
      }}
    >
      {PRESETS.map((p) => {
        const active = activePreset === p.key;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => apply(rangeForPreset(p.key))}
            style={{
              ...chip,
              color: active ? "#06120c" : "rgba(245,158,11,0.85)",
              background: active ? "#f59e0b" : "transparent",
              borderColor: active ? "#f59e0b" : "rgba(245,158,11,0.4)",
            }}
          >
            {p.label}
          </button>
        );
      })}
      <span
        style={{
          color: "rgba(192,200,206,0.45)",
          fontSize: "0.7rem",
          letterSpacing: "0.15em",
          textTransform: "uppercase",
        }}
      >
        Custom
      </span>
      <input
        type="date"
        value={value.from ?? ""}
        onChange={(e) =>
          apply({ from: e.target.value || null, to: value.to })
        }
        aria-label="From date"
        style={dateInput}
      />
      <span style={{ color: "rgba(192,200,206,0.55)" }}>—</span>
      <input
        type="date"
        value={value.to ?? ""}
        onChange={(e) =>
          apply({ from: value.from, to: e.target.value || null })
        }
        aria-label="To date"
        style={dateInput}
      />
    </div>
  );
}

const chip: React.CSSProperties = {
  padding: "0.35rem 0.85rem",
  border: "1px solid rgba(245,158,11,0.4)",
  fontFamily: "var(--font-body)",
  fontSize: "0.62rem",
  letterSpacing: "0.22em",
  background: "transparent",
  cursor: "pointer",
  textTransform: "uppercase",
};

const dateInput: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(245,158,11,0.3)",
  color: "#fbf3d4",
  fontFamily: "var(--font-body)",
  fontSize: "0.78rem",
  padding: "0.3rem 0.5rem",
  letterSpacing: "0.05em",
};
