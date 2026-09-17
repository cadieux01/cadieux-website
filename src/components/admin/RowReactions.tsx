"use client";

// Emoji reactions on an admin board row. Shared verbatim by /admin/orders and
// /admin/subscriptions — the two boards render the same <tr> shape, and a
// reaction that behaved differently between them would be a bug the operator
// hits on the day they switch boards.
//
// Opening the picker:
//   touch/pen — press and hold the row for 2 seconds
//   mouse     — right-click the row
//
// THE HOLD IS CANCELLED BY ANY MOVEMENT. This is the part that goes wrong in
// naive implementations: a finger resting on a row while the list scrolls is
// indistinguishable from a deliberate hold if you only watch the clock, so
// every scroll down a long board fires a reaction on whatever row the thumb
// happened to land on. Six independent cancels are wired below — see
// beginHold() — and they are all load-bearing, because the platforms disagree
// about which events they send. iOS fires `scroll` without ever sending
// `pointermove`; Android fires `touchmove` first; a trackpad two-finger
// scroll over a hovered row fires `wheel` and nothing else.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { adminActor } from "@/lib/admin-actor";
import { adminFetch } from "@/lib/admin-client";
import type { ReactionTally } from "@/lib/order-reactions";
import {
  EMOJI_COUNT,
  EMOJI_GROUPS,
  PINNED_EMOJI,
  splitByCodePoint,
} from "@/lib/emoji-data";

const CREAM = "#FBF3D4";
const cream = (a: number) => `rgba(251,243,212,${a})`;
const INK = "#1D1D1F";

/** How long the finger must stay still before the picker opens. */
const HOLD_MS = 2000;

/**
 * Movement that cancels the hold, in CSS px.
 *
 * 10px, not 0: a finger held against glass drifts by a pixel or two from
 * pulse alone, and a zero threshold would make the gesture impossible to
 * complete. 10px is below the ~15px browsers use to start a scroll, so any
 * movement that could become a scroll cancels first.
 */
const MOVE_TOLERANCE_PX = 10;

const PICKER_WIDTH = 360;
const PICKER_HEIGHT = 380;
/** Gap between the row and the picker, and the minimum margin to the viewport. */
const GAP = 8;

type OwnerKind = "order" | "subscription";

/**
 * Merge into the <tr>'s own `style`. Deliberately NOT returned from
 * rowProps(): both boards set `style` on the row AFTER their prop spread, so
 * a style coming out of the spread would be silently discarded and the iOS
 * callout would come back with no compile error to show for it.
 */
export const ROW_GESTURE_STYLE = {
  // Stops iOS raising the copy/share callout on a long press, and stops the
  // row text turning blue mid-gesture. The row's own onClick still checks
  // window.getSelection(), which now only ever sees deliberate selections.
  WebkitTouchCallout: "none",
  WebkitUserSelect: "none",
  userSelect: "none",
} as const;

type OpenState = {
  id: string;
  /** Viewport rect of the row that was held, for anchoring. */
  rect: { top: number; bottom: number; left: number; width: number };
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Board-level reaction state.
 *
 * `seed` is the tallies the list endpoint already hydrated, so the board
 * paints reactions on first render with no extra round trip. Local toggles
 * layer over it in `overrides` rather than mutating it, so a background board
 * refresh re-seeding `seed` cannot resurrect a reaction the operator just
 * removed.
 */
export function useRowReactions(
  kind: OwnerKind,
  seed: Map<string, ReactionTally[]>,
) {
  const [open, setOpen] = useState<OpenState | null>(null);
  const [overrides, setOverrides] = useState<Map<string, ReactionTally[]>>(
    () => new Map(),
  );
  const [error, setError] = useState<string | null>(null);

  // Set while a long-press has just fired, so the click that the browser
  // sends on release does not also run the row's navigate-to-detail handler.
  const suppressClick = useRef(false);

  const talliesFor = useCallback(
    (id: string): ReactionTally[] => overrides.get(id) ?? seed.get(id) ?? [],
    [overrides, seed],
  );

  const actor = useMemo(
    () => (typeof window === "undefined" ? "unknown" : adminActor()),
    [],
  );

  const toggle = useCallback(
    async (id: string, emoji: string) => {
      setError(null);
      try {
        const res = await adminFetch<{ reactions: ReactionTally[] }>(
          "/api/admin/reactions",
          {
            method: "POST",
            body: JSON.stringify({
              [kind === "order" ? "order_id" : "subscription_id"]: id,
              emoji,
              author: actor,
            }),
          },
        );
        // Server truth, not an optimistic guess: the toggle can resolve three
        // ways (insert / replace / delete) and a second tab may have moved
        // the row underneath us.
        setOverrides((curr) => {
          const next = new Map(curr);
          next.set(id, res.reactions);
          return next;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save reaction.");
      }
    },
    [kind, actor],
  );

  // ---- the long-press gesture -------------------------------------------

  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const lastPointerType = useRef<string>("mouse");
  const cleanup = useRef<(() => void) | null>(null);

  const cancelHold = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
    cleanup.current?.();
    cleanup.current = null;
  }, []);

  const openFor = useCallback((el: HTMLElement, id: string) => {
    const r = el.getBoundingClientRect();
    setOpen({
      id,
      rect: { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
    });
  }, []);

  const beginHold = useCallback(
    (e: React.PointerEvent<HTMLElement>, id: string) => {
      lastPointerType.current = e.pointerType;
      // Mouse holds are NOT a gesture here — desktop opens the picker with
      // right-click (onContextMenu below). Running the timer for a mouse too
      // would mean an operator who clicks a row and gets distracted mid-click
      // opens a picker instead of the order they asked for.
      if (e.pointerType === "mouse") return;
      // Secondary/multi-touch is not a hold either.
      if (e.isPrimary === false) return;

      cancelHold();
      const el = e.currentTarget;
      origin.current = { x: e.clientX, y: e.clientY };

      const onMove = (ev: PointerEvent) => {
        const o = origin.current;
        if (!o) return;
        if (
          Math.abs(ev.clientX - o.x) > MOVE_TOLERANCE_PX ||
          Math.abs(ev.clientY - o.y) > MOVE_TOLERANCE_PX
        ) {
          cancelHold();
        }
      };
      // Any scroll at all kills the hold — no tolerance. If the list moved,
      // the finger was driving it, not resting on a row.
      const onScrollOrCancel = () => cancelHold();

      // capture:true so a scroll on ANY ancestor (the page, or a scrolling
      // container around the table) is seen; scroll does not bubble.
      window.addEventListener("scroll", onScrollOrCancel, {
        capture: true,
        passive: true,
      });
      window.addEventListener("wheel", onScrollOrCancel, { passive: true });
      window.addEventListener("touchmove", onScrollOrCancel, { passive: true });
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointercancel", onScrollOrCancel);
      window.addEventListener("pointerup", onScrollOrCancel);

      cleanup.current = () => {
        window.removeEventListener("scroll", onScrollOrCancel, {
          capture: true,
        } as EventListenerOptions);
        window.removeEventListener("wheel", onScrollOrCancel);
        window.removeEventListener("touchmove", onScrollOrCancel);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointercancel", onScrollOrCancel);
        window.removeEventListener("pointerup", onScrollOrCancel);
      };

      timer.current = window.setTimeout(() => {
        timer.current = null;
        // Swallow the click the browser sends when the finger lifts, so the
        // row's onClick does not navigate out from under the picker.
        suppressClick.current = true;
        openFor(el, id);
        cancelHold();
      }, HOLD_MS);
    },
    [cancelHold, openFor],
  );

  // Unmount safety: a pending timer that fires after the board is gone would
  // setState on a dead component, and the window listeners would leak.
  useEffect(() => cancelHold, [cancelHold]);

  /**
   * Spread onto the board's <tr>.
   *
   * onClickCapture runs before the row's own onClick, which is the only place
   * the post-long-press click can be stopped — by the time the bubble phase
   * reaches the navigate handler it is too late.
   */
  const rowProps = useCallback(
    (id: string) => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => beginHold(e, id),
      onPointerUp: cancelHold,
      onPointerLeave: cancelHold,
      onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
        // Always preventDefault. On a mouse this replaces the browser menu
        // with ours. On touch, Android Chrome fires contextmenu at roughly
        // 500ms, which would open the picker a second and a half early and
        // make the 2s rule a lie — so it is swallowed and the timer above
        // stays the only way in.
        e.preventDefault();
        if (lastPointerType.current !== "mouse") return;
        cancelHold();
        suppressClick.current = true;
        openFor(e.currentTarget, id);
      },
      onClickCapture: (e: React.MouseEvent<HTMLElement>) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    }),
    [beginHold, cancelHold, openFor],
  );

  const picker = open ? (
    <EmojiPicker
      anchor={open.rect}
      selected={
        talliesFor(open.id).find((t) => t.authors.includes(actor))?.emoji ?? null
      }
      onPick={(emoji) => {
        void toggle(open.id, emoji);
        setOpen(null);
      }}
      onClose={() => setOpen(null)}
    />
  ) : null;

  return { rowProps, talliesFor, toggle, actor, picker, error, isOpen: !!open };
}

// ---------------------------------------------------------------------------
// Badges shown on the row
// ---------------------------------------------------------------------------

export function ReactionBadges({
  tallies,
  actor,
  onToggle,
}: {
  tallies: ReactionTally[];
  actor: string;
  onToggle: (emoji: string) => void;
}) {
  if (tallies.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
      {tallies.map((t) => {
        const mine = t.authors.includes(actor);
        return (
          <button
            key={t.emoji}
            type="button"
            // A <button> is in ROW_INTERACTIVE_SELECTOR on both boards, so
            // clicking a badge does not also open the row.
            onClick={() => onToggle(t.emoji)}
            title={`${t.authors.join(", ")}${mine ? " — tap to remove yours" : ""}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "1px 6px",
              borderRadius: 999,
              cursor: "pointer",
              fontSize: "0.875rem",
              lineHeight: 1.6,
              // The operator's own reaction is outlined so they can see at a
              // glance which one a second tap would remove.
              background: mine ? cream(0.16) : cream(0.06),
              border: `1px solid ${mine ? cream(0.55) : cream(0.18)}`,
              color: CREAM,
            }}
          >
            <span>{t.emoji}</span>
            {t.count > 1 ? (
              <span style={{ fontSize: "0.75rem", color: cream(0.75) }}>
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The picker
// ---------------------------------------------------------------------------

function EmojiPicker({
  anchor,
  selected,
  onPick,
  onClose,
}: {
  anchor: OpenState["rect"];
  selected: string | null;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const [group, setGroup] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Escape closes. Any scroll closes too: the picker is anchored to a rect
  // captured at open time, so once the page moves it is pointing at the wrong
  // row, and a reaction filed against the wrong order is worse than a picker
  // that dismissed itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, { capture: true, passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, {
        capture: true,
      } as EventListenerOptions);
    };
  }, [onClose]);

  // Measured before paint so the panel never appears in the wrong place and
  // jumps: useLayoutEffect, not useEffect.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Flip ABOVE the row when there is not enough room below. Prefers below,
    // falls back to above, and only then settles for whichever side has more
    // space — so a row taller than the viewport still gets a usable panel
    // instead of one clipped off the bottom.
    const below = vh - anchor.bottom - GAP;
    const above = anchor.top - GAP;
    const top =
      below >= PICKER_HEIGHT
        ? anchor.bottom + GAP
        : above >= PICKER_HEIGHT
          ? anchor.top - GAP - PICKER_HEIGHT
          : below >= above
            ? Math.max(GAP, vh - PICKER_HEIGHT - GAP)
            : GAP;

    // Horizontally centred on the row, then clamped so neither edge leaves
    // the viewport on a narrow phone.
    const width = Math.min(PICKER_WIDTH, vw - GAP * 2);
    const centred = anchor.left + anchor.width / 2 - width / 2;
    const left = Math.min(Math.max(GAP, centred), vw - width - GAP);

    setPos({ top, left });
  }, [anchor]);

  if (!mounted || typeof document === "undefined") return null;

  const width = Math.min(PICKER_WIDTH, window.innerWidth - GAP * 2);

  return createPortal(
    <>
      {/* Backdrop. Transparent, but it must exist: without it the first tap
          outside the picker would land on whatever row is underneath and
          navigate away instead of dismissing. */}
      <div
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
        style={{ position: "fixed", inset: 0, zIndex: 998 }}
      />
      <div
        role="dialog"
        aria-label="Add a reaction"
        style={{
          position: "fixed",
          top: pos?.top ?? -9999,
          left: pos?.left ?? -9999,
          width,
          height: PICKER_HEIGHT,
          zIndex: 999,
          display: "flex",
          flexDirection: "column",
          background: INK,
          border: `1px solid ${cream(0.28)}`,
          borderRadius: 10,
          boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
          overflow: "hidden",
        }}
      >
        {/* Pinned row — the dozen an operator actually reaches for. */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 2,
            padding: 8,
            borderBottom: `1px solid ${cream(0.16)}`,
          }}
        >
          {PINNED_EMOJI.map((e) => (
            <EmojiCell
              key={e}
              emoji={e}
              selected={e === selected}
              onPick={onPick}
            />
          ))}
        </div>

        {/* Category tabs for the full palette. */}
        <div
          style={{
            display: "flex",
            gap: 2,
            padding: "6px 8px",
            overflowX: "auto",
            borderBottom: `1px solid ${cream(0.16)}`,
          }}
        >
          {EMOJI_GROUPS.map((g, i) => (
            <button
              key={g.name}
              type="button"
              onClick={() => setGroup(i)}
              style={{
                flex: "0 0 auto",
                padding: "3px 8px",
                borderRadius: 999,
                cursor: "pointer",
                whiteSpace: "nowrap",
                fontSize: "0.75rem",
                background: i === group ? CREAM : "transparent",
                color: i === group ? INK : cream(0.75),
                border: `1px solid ${i === group ? CREAM : cream(0.22)}`,
              }}
            >
              {g.name}
            </button>
          ))}
        </div>

        {/* The grid. Only the active group is mounted — rendering all 1,219
            cells at once costs a visible pause on a mid-range Android. */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 8,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(34px, 1fr))",
            gap: 2,
          }}
        >
          {splitByCodePoint(EMOJI_GROUPS[group].emoji).map((e) => (
            <EmojiCell
              key={e}
              emoji={e}
              selected={e === selected}
              onPick={onPick}
            />
          ))}
        </div>

        <div
          style={{
            padding: "5px 8px",
            borderTop: `1px solid ${cream(0.16)}`,
            fontSize: "0.6875rem",
            color: cream(0.55),
          }}
        >
          {selected
            ? `Tap ${selected} again to remove it · ${EMOJI_COUNT} emoji`
            : `${EMOJI_COUNT} emoji · one reaction each`}
        </div>
      </div>
    </>,
    document.body,
  );
}

function EmojiCell({
  emoji,
  selected,
  onPick,
}: {
  emoji: string;
  selected: boolean;
  onPick: (emoji: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(emoji)}
      aria-label={emoji}
      aria-pressed={selected}
      style={{
        height: 32,
        fontSize: "1.25rem",
        lineHeight: 1,
        cursor: "pointer",
        borderRadius: 6,
        background: selected ? cream(0.22) : "transparent",
        border: `1px solid ${selected ? cream(0.5) : "transparent"}`,
      }}
    >
      {emoji}
    </button>
  );
}
