"use client";

// Brand-styled custom dropdown — replaces native <select> across the site.
//
// Why: native <select> renders an OS-themed option menu (white-on-black on
// some platforms, no control over fonts/radius/highlight) that never matched
// the Foundation-Green/cream/gold palette. This is a fully self-rendered
// listbox so every part (trigger, menu, option highlight, selected check) is
// brand-controlled and consistent across desktop + mobile.
//
// Behaviour preserved for callers: controlled `value` + `onChange(value)`
// with the same string values the native <select> emitted, so no form logic
// or submitted values change. An optional hidden <input name> is rendered so
// native form submission still sees the value.
//
// Accessibility: ARIA combobox/listbox roles, keyboard nav (Up/Down/Home/End,
// Enter/Space select, Esc close, type-ahead), click-outside close, focus ring.
//
// Portal: the menu is rendered into `document.body` with `position: fixed`,
// anchored to the trigger's `getBoundingClientRect()`. That puts it outside
// every ancestor `overflow`/`transform` context — admin tables that scroll
// horizontally used to clip the status menu at 390px. Position is re-measured
// on open, on scroll (capture, so ancestor scrollers count) and on resize.
//
// Sizing: the menu is measured, not capped at a magic number. It takes its
// content height, clamped only to the space actually free above/below the
// trigger, so a new option can't silently push the list behind a scrollbar.
// Width is the trigger's, floored at MIN_MENU_WIDTH so narrow table triggers
// stop ellipsizing their own option labels.
//
// Lenis: the menu carries `data-lenis-prevent` so its internal scroll works
// while the page's smooth-scroll is paused over it.
//
// Cursor: under the animated ("dough") cursor every element gets
// `cursor: none`, so clickability is signalled purely by the gold hover /
// active highlight rather than a pointer — handled by the styles below.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  /** Merged into the trigger button — use for width/min-width per call site. */
  style?: React.CSSProperties;
  /** Defaults to true; the trigger fills its container. */
  fullWidth?: boolean;
}

const GOLD = "#024628";
const CREAM = "#FBF3D4";
const MENU_BG = "#024628";

/** Gap between trigger and menu, and the margin the menu keeps off every
 *  viewport edge. */
const GAP = 6;
const MARGIN = 8;
/** Floor so the menu never collapses to a sliver on a very short viewport —
 *  below this it scrolls instead. */
const MIN_MENU_HEIGHT = 120;
/** The menu no longer inherits the trigger's width when the trigger is narrow.
 *  Admin table triggers are ~140px, which used to ellipsize "Out for
 *  delivery"; this is wide enough for the longest status label at 16px. */
const MIN_MENU_WIDTH = 240;

export default function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  id,
  name,
  disabled = false,
  ariaLabel,
  className,
  style,
  fullWidth = true,
}: SelectProps) {
  const reactId = useId();
  const baseId = id ?? `sel-${reactId.replace(/[:]/g, "")}`;
  const listboxId = `${baseId}-listbox`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // The menu renders in a portal on <body>, so it needs viewport coordinates
  // measured from the trigger rather than `position: absolute` inside the
  // widget. `top`/`bottom` are mutually exclusive (drop-down vs flip-up).
  const [menuPos, setMenuPos] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    top: number | null;
    bottom: number | null;
    /** Copied off the trigger: on <body> the menu no longer inherits any
     *  scoped typography (e.g. the admin's Nunito override). */
    fontFamily: string;
  } | null>(null);
  const [mounted, setMounted] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const typeahead = useRef<{ buf: string; t: number }>({ buf: "", t: 0 });

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selectedLabel = selectedIndex >= 0 ? options[selectedIndex].label : "";

  const firstEnabled = useCallback(
    (from: number, dir: 1 | -1) => {
      let i = from;
      for (let n = 0; n < options.length; n++) {
        if (i >= 0 && i < options.length && !options[i].disabled) return i;
        i += dir;
      }
      return -1;
    },
    [options],
  );

  const openMenu = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    const start =
      selectedIndex >= 0 && !options[selectedIndex]?.disabled
        ? selectedIndex
        : firstEnabled(0, 1);
    setActiveIndex(start);
  }, [disabled, selectedIndex, options, firstEnabled]);

  const closeMenu = useCallback((refocus = true) => {
    setOpen(false);
    setActiveIndex(-1);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const pick = useCallback(
    (i: number) => {
      const opt = options[i];
      if (!opt || opt.disabled) return;
      onChange(opt.value);
      closeMenu();
    },
    [options, onChange, closeMenu],
  );

  // The menu lives in a portal on <body>, which takes it out of every ancestor
  // `overflow` context (admin tables scroll horizontally; cards clip) — so it
  // can never be clipped. The cost is that it no longer moves with the trigger
  // automatically, so re-measure on open, on scroll (capture: true catches
  // ancestor scroll containers, not just the window) and on resize.
  useEffect(() => setMounted(true), []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const rect = trigger?.getBoundingClientRect();
    if (!trigger || !rect) return;

    const below = Math.max(0, window.innerHeight - rect.bottom - GAP - MARGIN);
    const above = Math.max(0, rect.top - GAP - MARGIN);

    // How tall the menu actually wants to be. `scrollHeight` reports the full
    // content height even while `max-height` is clipping it, and includes the
    // list's own padding; add the 1px borders it leaves out. On the very first
    // pass the menu isn't in the DOM yet, so assume it wants everything — the
    // second pass (below) re-runs with the real measurement.
    const menu = menuRef.current;
    const wanted = menu ? menu.scrollHeight + 2 : Number.POSITIVE_INFINITY;

    // Drop down unless the content genuinely doesn't fit below and there is
    // more room above. Never flip just because of an arbitrary cap.
    const flipUp = wanted > below && above > below;
    const space = flipUp ? above : below;

    const width = Math.min(
      Math.max(rect.width, MIN_MENU_WIDTH),
      window.innerWidth - MARGIN * 2,
    );
    const left = Math.min(
      Math.max(MARGIN, rect.left),
      Math.max(MARGIN, window.innerWidth - width - MARGIN),
    );

    const next = {
      left,
      width,
      // Size to content; only clamp to what the viewport really offers. The
      // floor means a cramped viewport scrolls rather than collapsing.
      maxHeight: Math.max(MIN_MENU_HEIGHT, Math.min(wanted, space)),
      top: flipUp ? null : rect.bottom + GAP,
      bottom: flipUp ? window.innerHeight - rect.top + GAP : null,
      fontFamily: getComputedStyle(trigger).fontFamily,
    };

    // Bail out when nothing moved. Scroll fires constantly, and the measure
    // pass below re-enters through `menuPos` — without this it would loop.
    setMenuPos((prev) =>
      prev &&
      prev.left === next.left &&
      prev.width === next.width &&
      prev.maxHeight === next.maxHeight &&
      prev.top === next.top &&
      prev.bottom === next.bottom &&
      prev.fontFamily === next.fontFamily
        ? prev
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  // Second pass: the first run positions a menu that doesn't exist yet, so
  // re-run once it's mounted and its content height can be measured. Converges
  // after one extra pass because `setMenuPos` above returns `prev` unchanged.
  useLayoutEffect(() => {
    if (!open || !menuPos) return;
    updatePosition();
  }, [open, menuPos, updatePosition]);

  // Keep the active option scrolled into view *inside the menu*.
  //
  // Deliberately not `scrollIntoView`: now that the menu sizes to its content
  // it is usually not scrollable, and `scrollIntoView` would then scroll the
  // page instead — which moves the trigger, which repositions the menu, which
  // puts the option out of view again. That loop hung keyboard navigation.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const menu = menuRef.current;
    const li = optionRefs.current[activeIndex];
    if (!menu || !li || menu.scrollHeight <= menu.clientHeight) return;
    const top = li.offsetTop;
    const bottom = top + li.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = bottom - menu.clientHeight;
    }
  }, [open, activeIndex]);

  // Close on outside click / focus leaving the widget.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // The menu is portalled out of rootRef, so check it separately.
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const moveActive = useCallback(
    (dir: 1 | -1) => {
      setActiveIndex((cur) => {
        const start = cur < 0 ? (dir === 1 ? -1 : options.length) : cur;
        const next = firstEnabled(start + dir, dir);
        return next === -1 ? cur : next;
      });
    },
    [firstEnabled, options.length],
  );

  const onTypeahead = useCallback(
    (ch: string) => {
      const now = Date.now();
      const ta = typeahead.current;
      ta.buf = now - ta.t > 600 ? ch : ta.buf + ch;
      ta.t = now;
      const q = ta.buf.toLowerCase();
      const match = options.findIndex(
        (o) => !o.disabled && o.label.toLowerCase().startsWith(q),
      );
      if (match >= 0) {
        if (open) setActiveIndex(match);
        else onChange(options[match].value);
      }
    },
    [options, open, onChange],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) openMenu();
        else moveActive(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) openMenu();
        else moveActive(-1);
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          setActiveIndex(firstEnabled(0, 1));
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          setActiveIndex(firstEnabled(options.length - 1, -1));
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (!open) openMenu();
        else if (activeIndex >= 0) pick(activeIndex);
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          closeMenu();
        }
        break;
      case "Tab":
        if (open) setOpen(false);
        break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          onTypeahead(e.key);
        }
    }
  };

  // Trigger sits on any parent bg (Clean Ash #C0C8CE on checkout + subscription
  // setup). We explicitly paint it Foundation Green so cream text always
  // renders at 9.88:1 (AAA) — never inherits an unknown parent bg.
  const triggerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    width: fullWidth ? "100%" : undefined,
    boxSizing: "border-box",
    background: "#024628",
    border: `1px solid ${open ? "#FBF3D4" : "rgba(251,243,212,0.35)"}`,
    borderRadius: 8,
    padding: "12px 14px",
    minHeight: 46,
    textAlign: "left",
    fontFamily: "var(--font-body)",
    fontSize: 16,
    fontWeight: 200,
    letterSpacing: "0.04em",
    color: selectedLabel ? "#FBF3D4" : "rgba(251,243,212,0.7)",
    boxShadow: open ? `0 0 0 2px rgba(251,243,212,0.35)` : "none",
    opacity: disabled ? 0.5 : 1,
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
    ...style,
  };

  return (
    <div
      ref={rootRef}
      className={className}
      style={{ position: "relative", width: fullWidth ? "100%" : undefined }}
    >
      <button
        ref={triggerRef}
        type="button"
        id={baseId}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        style={triggerStyle}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {selectedLabel || placeholder}
        </span>
        <svg
          width="12"
          height="8"
          viewBox="0 0 12 8"
          aria-hidden="true"
          style={{
            flex: "0 0 auto",
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.18s ease",
          }}
        >
          <path
            d="M1 1l5 5 5-5"
            stroke="#FBF3D4"
            strokeWidth="1.5"
            fill="none"
          />
        </svg>
      </button>

      {name !== undefined && (
        <input type="hidden" name={name} value={value} />
      )}

      {open &&
        mounted &&
        menuPos &&
        createPortal(
          <ul
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={-1}
            data-lenis-prevent
            style={{
              position: "fixed",
              left: menuPos.left,
              width: menuPos.width,
              ...(menuPos.top !== null
                ? { top: menuPos.top }
                : { bottom: menuPos.bottom as number }),
              zIndex: 1000,
              margin: 0,
              padding: 4,
              boxSizing: "border-box",
              listStyle: "none",
              fontFamily: menuPos.fontFamily,
              background: MENU_BG,
              border: `1px solid ${GOLD}`,
              borderRadius: 8,
              boxShadow: "0 14px 40px rgba(0,0,0,0.55)",
              maxHeight: menuPos.maxHeight,
              overflowY: "auto",
            }}
          >
            {options.map((opt, i) => {
              const isSelected = opt.value === value;
              const isActive = i === activeIndex;
              return (
                <li
                  key={opt.value + i}
                  ref={(el) => {
                    optionRefs.current[i] = el;
                  }}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled || undefined}
                  onClick={() => !opt.disabled && pick(i)}
                  onMouseEnter={() => !opt.disabled && setActiveIndex(i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "10px 12px",
                    borderRadius: 6,
                    // Font inherits from the <ul>, which copies the trigger's
                    // computed family — the portal has no scoped ancestor.
                    fontSize: 16,
                    fontWeight: 300,
                    letterSpacing: "0.03em",
                    lineHeight: 1.3,
                    // Cream on Foundation-Green menu = 9.88:1 AAA. Previously
                    // the selected option flipped to Foundation-Green text on
                    // the same green menu bg (~1:1, invisible). Keep the label
                    // cream and signal selection via a stronger cream tint bg
                    // + a bright checkmark instead.
                    color: opt.disabled
                      ? "rgba(251,243,212,0.5)"
                      : "#FBF3D4",
                    background: opt.disabled
                      ? "transparent"
                      : isActive
                        ? "rgba(251,243,212,0.14)"
                        : isSelected
                          ? "rgba(251,243,212,0.10)"
                          : "transparent",
                    transition: "background 0.1s ease",
                  }}
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {opt.label}
                  </span>
                  {isSelected && (
                    <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true" style={{ flex: "0 0 auto" }}>
                      <path
                        d="M2 7l3 3 6-7"
                        stroke="#FBF3D4"
                        strokeWidth="1.6"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}
