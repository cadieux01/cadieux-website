"use client";

// One date, or two, INFERRED FROM THE TAPS ALONE — the flight-booking model.
//
// Tap a day: that day. Tap a second: the two become a range. Tap again: the
// span is discarded and you are choosing a single day once more. There is no
// control that tells the picker which mode it is in, because there is nothing
// for such a control to decide — the operator's taps already say it, and a
// mode selector can only ever contradict them.
//
// WHAT THIS REPLACED, AND WHY IT IS NOT A STYLE CHANGE. The deliveries board
// used DayFilter's range opt-in: a "Span" dropdown reading Single day / Date
// range, which then swapped one date field for a From field and a To field.
// Three controls for one question, and they could disagree — a From and a To
// left filled while the dropdown said Single day still showed one date, and
// the operator had no way to see the other two were still set. Worse, the
// dropdown had to be found and set BEFORE the dates could be entered, so the
// commonest action on the board (one day) cost a decision about a concept
// (span) that the taps express for free. The dropdown is deleted, not hidden.
//
// CONFIRM IS THE ONLY WAY TO APPLY. Tapping a day changes nothing about the
// board. That is deliberate and it is the whole reason this component holds a
// draft: a range takes two taps, and a picker that filtered on the first one
// would show a one-day list nobody asked for, then flicker to the range. Any
// other dismissal — click-away, Escape, or re-tapping the trigger — DISCARDS.
//
// Clear empties the draft; it does not apply on its own. Two buttons that
// both apply, one of them named Clear, is the ambiguity DayFilter's own
// `showClear` note warns about. So Clear then Confirm is how the operator
// asks for every date, and Confirm is the single apply path on the screen.
//
// Both buttons live INSIDE the open calendar and do not exist when it is
// closed. Closed, there is no draft to confirm and nothing to clear that
// isn't already visible on the trigger.
//
// The semantics stay in @/lib/day-filter — this file only produces a
// DaySelection. A single tap yields `{ mode: "day" }`, which `matchesSelection`
// defines to mirror `matchesDay` exactly, so nothing about the one-day case
// changes by being reachable from here.

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import {
  ALL_DAYS,
  normaliseRange,
  type DaySelection,
} from "@/lib/day-filter";

const CREAM = "#FBF3D4";
const MENU_BG = "#024628";
const ICON = "#024628";

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
function parseIso(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function fmtDay(iso: string): string {
  const d = parseIso(iso);
  if (!d) return iso;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** What the selection reads as, on the trigger and in the footer. An open end
 *  is spelled "any" rather than left blank — a range with a missing end is
 *  unbounded on that side, which is a statement, not an omission. */
export function describeDaySelection(sel: DaySelection): string {
  if (sel.mode === "day") return sel.day ? fmtDay(sel.day) : "All dates";
  const { from, to } = normaliseRange(sel.from, sel.to);
  if (!from && !to) return "All dates";
  return `${from ? fmtDay(from) : "any"} → ${to ? fmtDay(to) : "any"}`;
}

/** The two ends a selection paints, whichever shape it is in. A single day is
 *  a range of one, which is what lets the grid below have a single code path
 *  instead of a branch per mode. */
function endsOf(sel: DaySelection): { from: string | null; to: string | null } {
  if (sel.mode === "day") return { from: sel.day, to: sel.day };
  return normaliseRange(sel.from, sel.to);
}

export type DateSpanPickerProps = {
  /** The selection currently in force on the board. */
  value: DaySelection;
  /** Called only by Confirm. Never on a tap, never on dismissal. */
  onApply: (next: DaySelection) => void;
  id?: string;
  ariaLabel?: string;
};

export default function DateSpanPicker({
  value,
  onApply,
  id,
  ariaLabel,
}: DateSpanPickerProps) {
  const reactId = useId();
  const baseId = id ?? `dsp-${reactId.replace(/[:]/g, "")}`;

  const [open, setOpen] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const [draft, setDraft] = useState<DaySelection>(value);
  // The day tapped first, while the second tap is still outstanding.
  //
  // This — not the draft's shape — is what makes the next tap EXTEND rather
  // than RESTART. Deriving it from the draft instead would make a one-day
  // draft permanently extendable, so a range could never be narrowed back to
  // a single day: every subsequent tap would keep pairing with the old one.
  // null means the next tap starts over.
  const [anchor, setAnchor] = useState<string | null>(null);
  const [view, setView] = useState<Date>(() =>
    startOfMonth(parseIso(endsOf(value).from) ?? new Date()),
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Opening RE-SEEDS from `value`, which is what makes discarding free: a
  // dismissed draft is never cleaned up, it is simply overwritten next time.
  // Without this, a click-away would leave the abandoned draft on screen at
  // the next open, looking applied when it is not.
  useEffect(() => {
    if (!open) return;
    setDraft(value);
    setAnchor(null);
    setView(startOfMonth(parseIso(endsOf(value).from) ?? new Date()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    setFlipUp(below < 400 && rect.top > below);
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

  const tapDay = (iso: string) => {
    // Second tap on a DIFFERENT day: the pair becomes a range, normalised
    // here so tapping the later day first is not a mistake the operator has
    // to notice. Tapping the SAME day twice means "just that day" and leaves
    // a single-day selection rather than a one-day range — identical to
    // matchesSelection, but it reads honestly on the trigger.
    if (anchor && anchor !== iso) {
      setDraft({ mode: "range", ...normaliseRange(anchor, iso) });
      setAnchor(null);
      return;
    }
    setDraft({ mode: "day", day: iso });
    setAnchor(anchor === iso ? null : iso);
  };

  const confirm = () => {
    onApply(draft);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const monthStart = startOfMonth(view);
  const daysInMonth = new Date(
    view.getFullYear(),
    view.getMonth() + 1,
    0,
  ).getDate();
  const leadBlanks = monthStart.getDay();

  const ends = endsOf(draft);
  const hasDraft = Boolean(ends.from || ends.to);
  const todayIso = toIso(new Date());
  // Whether the APPLIED selection is empty, for the trigger's muted
  // placeholder colour. Taken from `endsOf` rather than `value.mode === "day"
  // && !value.day`, because a hand-typed `?mode=range` with no dates is also
  // empty — it reads "All dates" and must not be painted as a live filter.
  const appliedEnds = endsOf(value);
  const nothingApplied = !appliedEnds.from && !appliedEnds.to;

  const triggerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    width: "100%",
    boxSizing: "border-box",
    background: MENU_BG,
    border: `1px solid ${open ? CREAM : "rgba(251,243,212,0.35)"}`,
    borderRadius: 8,
    padding: "12px 14px",
    minHeight: 46,
    textAlign: "left",
    fontFamily: "var(--font-body)",
    fontSize: 16,
    fontWeight: 200,
    letterSpacing: "0.04em",
    color: nothingApplied ? "rgba(251,243,212,0.7)" : CREAM,
    boxShadow: open ? "0 0 0 2px rgba(251,243,212,0.35)" : "none",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
  };

  const navBtn: React.CSSProperties = {
    background: "transparent",
    border: "none",
    color: CREAM,
    fontSize: 18,
    lineHeight: 1,
    padding: "4px 8px",
    borderRadius: 6,
  };

  const footBtn: React.CSSProperties = {
    flex: "1 1 auto",
    padding: "0.5rem 0.6rem",
    border: `1px solid rgba(251,243,212,0.35)`,
    background: "transparent",
    color: CREAM,
    fontFamily: "var(--font-body)",
    fontSize: "0.7rem",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    borderRadius: 7,
    cursor: "pointer",
  };

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
          {describeDaySelection(value)}
        </span>
        <svg
          width="15"
          height="15"
          viewBox="0 0 16 16"
          aria-hidden="true"
          style={{ flex: "0 0 auto" }}
        >
          <rect
            x="2"
            y="3"
            width="12"
            height="11"
            rx="1.5"
            stroke={ICON}
            strokeWidth="1.2"
            fill="none"
          />
          <path d="M2 6h12M5 1.5v3M11 1.5v3" stroke={ICON} strokeWidth="1.2" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={ariaLabel ?? "Choose a date or a range"}
          data-lenis-prevent
          style={{
            position: "absolute",
            left: 0,
            zIndex: 1000,
            width: 300,
            maxWidth: "calc(100vw - 32px)",
            padding: 14,
            background: MENU_BG,
            border: `1px solid rgba(251,243,212,0.35)`,
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
              onClick={() =>
                setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))
              }
              style={navBtn}
            >
              ‹
            </button>
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 16,
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
                  fontSize: 14,
                  fontWeight: 500,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "rgba(251,243,212,0.7)",
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
              const d = new Date(view.getFullYear(), view.getMonth(), i + 1);
              const iso = toIso(d);
              // An END is painted as the solid cream chip; a day strictly
              // BETWEEN the ends is tinted. Comparison is lexicographic,
              // which is exact for YYYY-MM-DD.
              const isEnd = iso === ends.from || iso === ends.to;
              const inSpan =
                !isEnd &&
                Boolean(ends.from && ends.to) &&
                iso > (ends.from as string) &&
                iso < (ends.to as string);
              const isToday = iso === todayIso;
              return (
                <button
                  key={iso}
                  type="button"
                  aria-pressed={isEnd || inSpan}
                  onClick={() => tapDay(iso)}
                  style={{
                    aspectRatio: "1 / 1",
                    border:
                      isToday && !isEnd
                        ? `1px solid rgba(251,243,212,0.45)`
                        : "1px solid transparent",
                    borderRadius: 7,
                    background: isEnd
                      ? CREAM
                      : inSpan
                        ? "rgba(251,243,212,0.22)"
                        : "transparent",
                    color: isEnd ? MENU_BG : CREAM,
                    fontFamily: "var(--font-body)",
                    fontSize: 14,
                    fontWeight: isEnd ? 600 : 300,
                    transition: "background 0.1s ease",
                  }}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>

          {/* The draft, spelled out. The trigger behind this panel still shows
              what is APPLIED, so without this line the two dates on screen
              would be indistinguishable and Confirm would look like a no-op.
              When one tap is outstanding it says so, which is the only hint
              the range mechanic needs. */}
          <div
            style={{
              marginTop: 10,
              fontFamily: "var(--font-body)",
              fontSize: "0.72rem",
              letterSpacing: "0.06em",
              color: CREAM,
            }}
          >
            {describeDaySelection(draft)}
            {anchor ? (
              <span style={{ color: "rgba(251,243,212,0.7)" }}>
                {" "}
                — tap another day for a range
              </span>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => {
                setDraft(ALL_DAYS);
                setAnchor(null);
              }}
              disabled={!hasDraft}
              style={{
                ...footBtn,
                opacity: hasDraft ? 1 : 0.4,
                cursor: hasDraft ? "pointer" : "default",
              }}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={confirm}
              style={{
                ...footBtn,
                background: CREAM,
                color: MENU_BG,
                borderColor: CREAM,
                fontWeight: 600,
              }}
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
