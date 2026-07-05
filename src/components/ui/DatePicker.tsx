"use client";

// Brand-styled calendar popover — replaces native <input type="date">.
//
// Emits/accepts the same `YYYY-MM-DD` string the native input did, parsed and
// formatted in LOCAL time (so a date never drifts a day across timezones).
// `min` (also YYYY-MM-DD) disables earlier days. Foundation-Green / cream /
// gold palette, keyboard + click-outside, Lenis-safe (data-lenis-prevent).

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

const GOLD = "#024628";
const CREAM = "#FBF3D4";
const MENU_BG = "#024628";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toIso(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseIso(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  placeholder?: string;
  id?: string;
  name?: string;
  ariaLabel?: string;
  style?: React.CSSProperties;
}

export default function DatePicker({
  value,
  onChange,
  min,
  placeholder = "Select a date…",
  id,
  name,
  ariaLabel,
  style,
}: DatePickerProps) {
  const reactId = useId();
  const baseId = id ?? `dp-${reactId.replace(/[:]/g, "")}`;

  const selected = parseIso(value);
  const minDate = min ? parseIso(min) : null;

  const [open, setOpen] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const [view, setView] = useState<Date>(() =>
    startOfDay(selected ?? minDate ?? new Date()),
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) setView(startOfDay(selected ?? minDate ?? new Date()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    setFlipUp(below < 360 && rect.top > below);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const monthStart = new Date(view.getFullYear(), view.getMonth(), 1);
  const daysInMonth = new Date(
    view.getFullYear(),
    view.getMonth() + 1,
    0,
  ).getDate();
  const leadBlanks = monthStart.getDay();

  const canPrev =
    !minDate ||
    monthStart > new Date(minDate.getFullYear(), minDate.getMonth(), 1);

  const triggerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    width: "100%",
    boxSizing: "border-box",
    background: "transparent",
    border: `1px solid ${open ? GOLD : "rgba(240,223,200,0.16)"}`,
    borderRadius: 8,
    padding: "12px 14px",
    minHeight: 46,
    textAlign: "left",
    fontFamily: "var(--font-body)",
    fontSize: 15,
    fontWeight: 200,
    letterSpacing: "0.04em",
    color: selected ? CREAM : "rgba(240,223,200,0.4)",
    boxShadow: open ? `0 0 0 2px rgba(201,169,110,0.25)` : "none",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
    ...style,
  };

  const navBtn: React.CSSProperties = {
    background: "transparent",
    border: "none",
    color: GOLD,
    fontSize: 18,
    lineHeight: 1,
    padding: "4px 8px",
    borderRadius: 6,
  };

  const fmtTrigger = selected
    ? selected.toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : placeholder;

  return (
    <div ref={rootRef} style={{ position: "relative", width: "100%" }}>
      <button
        ref={triggerRef}
        type="button"
        id={baseId}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        style={triggerStyle}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {fmtTrigger}
        </span>
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" style={{ flex: "0 0 auto" }}>
          <rect x="2" y="3" width="12" height="11" rx="1.5" stroke={GOLD} strokeWidth="1.2" fill="none" />
          <path d="M2 6h12M5 1.5v3M11 1.5v3" stroke={GOLD} strokeWidth="1.2" />
        </svg>
      </button>

      {name !== undefined && (
        <input type="hidden" name={name} value={value} />
      )}

      {open && (
        <div
          role="dialog"
          aria-label={ariaLabel ?? "Choose a date"}
          data-lenis-prevent
          style={{
            position: "absolute",
            left: 0,
            zIndex: 1000,
            width: 280,
            maxWidth: "calc(100vw - 32px)",
            padding: 14,
            background: MENU_BG,
            border: `1px solid ${GOLD}`,
            borderRadius: 10,
            boxShadow: "0 14px 40px rgba(0,0,0,0.55)",
            ...(flipUp
              ? { bottom: "calc(100% + 6px)" }
              : { top: "calc(100% + 6px)" }),
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <button
              type="button"
              aria-label="Previous month"
              disabled={!canPrev}
              onClick={() =>
                setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))
              }
              style={{ ...navBtn, opacity: canPrev ? 1 : 0.3 }}
            >
              ‹
            </button>
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 14,
                fontWeight: 300,
                letterSpacing: "0.06em",
                color: CREAM,
              }}
            >
              {MONTHS[view.getMonth()]} {view.getFullYear()}
            </div>
            <button
              type="button"
              aria-label="Next month"
              onClick={() =>
                setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))
              }
              style={navBtn}
            >
              ›
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 2,
              marginBottom: 4,
            }}
          >
            {DOW.map((d) => (
              <div
                key={d}
                style={{
                  textAlign: "center",
                  fontSize: 10,
                  fontWeight: 400,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "rgba(240,223,200,0.4)",
                  padding: "4px 0",
                }}
              >
                {d}
              </div>
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 2,
            }}
          >
            {Array.from({ length: leadBlanks }).map((_, i) => (
              <div key={`b${i}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const d = new Date(view.getFullYear(), view.getMonth(), day);
              const iso = toIso(d);
              const isSelected = !!selected && toIso(selected) === iso;
              const isDisabled = !!minDate && d < startOfDay(minDate);
              const isToday = toIso(new Date()) === iso;
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={isDisabled}
                  aria-pressed={isSelected}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  style={{
                    aspectRatio: "1 / 1",
                    border: isToday && !isSelected
                      ? `1px solid rgba(201,169,110,0.4)`
                      : "1px solid transparent",
                    borderRadius: 7,
                    background: isSelected ? GOLD : "transparent",
                    color: isDisabled
                      ? "rgba(251,243,212,0.22)"
                      : isSelected
                        ? "#0a0a0a"
                        : CREAM,
                    fontFamily: "var(--font-body)",
                    fontSize: 13,
                    fontWeight: isSelected ? 600 : 300,
                    transition: "background 0.1s ease",
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
