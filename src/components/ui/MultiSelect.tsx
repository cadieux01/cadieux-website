"use client";

// Brand-styled multi-select listbox — the tick-several sibling of ui/Select.
//
// WHY A SEPARATE COMPONENT, not a `multiple` flag on Select:
// Select is mounted on /checkout and /subscriptions/setup, i.e. on the two
// paths that take money. Its contract is `value: string` + "choosing closes
// the menu", and every one of its 12 call sites depends on both. A multi mode
// would have to fork the selection model, the trigger label, the checkmark,
// and the Enter/click handlers — four behavioural forks inside a component on
// the payment path, to serve one admin filter. Not worth the blast radius.
//
// The cost of that choice, stated plainly: the menu positioning below (portal
// to <body>, measure, flip-up, clamp) is duplicated from Select. It is the
// part most likely to drift. If a third caller ever needs it, extract it into
// a shared `useAnchoredMenu` hook and have BOTH widgets use it — don't copy
// it a third time.
//
// Differences from Select that are deliberate, not oversights:
//   • Clicking an option toggles it and the menu STAYS OPEN. Ticking three
//     statuses is the normal case; re-opening between each would make the
//     feature useless.
//   • The trigger label is passed in, because it summarises a set
//     ("Pending +2 (43)") and only the caller knows the counts.
//   • role=listbox gets aria-multiselectable; options render a checkbox.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Renders as a non-interactive group heading (e.g. "── Call updates ──"). */
  disabled?: boolean;
}

export interface MultiSelectProps {
  /** Currently-ticked values. Order is irrelevant; membership is what counts. */
  values: string[];
  /** Called with the option's value on every tick AND untick. The caller owns
   *  the set, so it can apply rules like "All clears the group". */
  onToggle: (value: string) => void;
  options: MultiSelectOption[];
  /** What the closed trigger reads. The caller composes it from the counts. */
  triggerLabel: string;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  fullWidth?: boolean;
  disabled?: boolean;
}

const CREAM = "#FBF3D4";
const MENU_BG = "#024628";

const GAP = 6;
const MARGIN = 8;
const MIN_MENU_HEIGHT = 120;
const MIN_MENU_WIDTH = 260;

export default function MultiSelect({
  values,
  onToggle,
  options,
  triggerLabel,
  ariaLabel,
  className,
  style,
  fullWidth = true,
  disabled = false,
}: MultiSelectProps) {
  const reactId = useId();
  const baseId = `msel-${reactId.replace(/[:]/g, "")}`;
  const listboxId = `${baseId}-listbox`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuPos, setMenuPos] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    top: number | null;
    bottom: number | null;
    fontFamily: string;
  } | null>(null);
  const [mounted, setMounted] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);

  const selectedSet = new Set(values);

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
    setActiveIndex(firstEnabled(0, 1));
  }, [disabled, firstEnabled]);

  const closeMenu = useCallback((refocus = true) => {
    setOpen(false);
    setActiveIndex(-1);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // The whole point of the widget: toggle, and STAY OPEN.
  const toggleAt = useCallback(
    (i: number) => {
      const opt = options[i];
      if (!opt || opt.disabled) return;
      onToggle(opt.value);
    },
    [options, onToggle],
  );

  useEffect(() => setMounted(true), []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const rect = trigger?.getBoundingClientRect();
    if (!trigger || !rect) return;

    const below = Math.max(0, window.innerHeight - rect.bottom - GAP - MARGIN);
    const above = Math.max(0, rect.top - GAP - MARGIN);

    const menu = menuRef.current;
    const wanted = menu ? menu.scrollHeight + 2 : Number.POSITIVE_INFINITY;

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
      maxHeight: Math.max(MIN_MENU_HEIGHT, Math.min(wanted, space)),
      top: flipUp ? null : rect.bottom + GAP,
      bottom: flipUp ? window.innerHeight - rect.top + GAP : null,
      fontFamily: getComputedStyle(trigger).fontFamily,
    };

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

  // Second pass once the menu exists and its height can be measured.
  useLayoutEffect(() => {
    if (!open || !menuPos) return;
    updatePosition();
  }, [open, menuPos, updatePosition]);

  // The option list re-renders on every toggle (labels carry live counts and
  // a newly-ticked zero-count option becomes visible), which can change the
  // menu's height underneath an open menu. Re-measure so it never overflows
  // the space it was sized for.
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, options, updatePosition]);

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

  // Close on outside click. The menu is portalled out of rootRef, so it has
  // to be tested separately or every click inside it would close the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
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
        else if (activeIndex >= 0) toggleAt(activeIndex);
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
    }
  };

  const triggerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    width: fullWidth ? "100%" : undefined,
    boxSizing: "border-box",
    background: "#024628",
    border: `1px solid ${open ? CREAM : "rgba(251,243,212,0.35)"}`,
    borderRadius: 8,
    padding: "12px 14px",
    minHeight: 46,
    textAlign: "left",
    fontFamily: "var(--font-body)",
    fontSize: 16,
    fontWeight: 200,
    letterSpacing: "0.04em",
    color: CREAM,
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
          {triggerLabel}
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
          <path d="M1 1l5 5 5-5" stroke={CREAM} strokeWidth="1.5" fill="none" />
        </svg>
      </button>

      {open &&
        mounted &&
        menuPos &&
        createPortal(
          <ul
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-multiselectable="true"
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
              border: `1px solid ${MENU_BG}`,
              borderRadius: 8,
              boxShadow: "0 14px 40px rgba(0,0,0,0.55)",
              maxHeight: menuPos.maxHeight,
              overflowY: "auto",
            }}
          >
            {options.map((opt, i) => {
              const isSelected = selectedSet.has(opt.value);
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
                  onClick={() => !opt.disabled && toggleAt(i)}
                  onMouseEnter={() => !opt.disabled && setActiveIndex(i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 6,
                    fontSize: 16,
                    fontWeight: 300,
                    letterSpacing: "0.03em",
                    lineHeight: 1.3,
                    color: opt.disabled ? "rgba(251,243,212,0.5)" : CREAM,
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
                  {/* Checkbox. Purely presentational — the <li> carries the
                      role and the aria-selected state, so a real <input>
                      here would be a second, conflicting a11y target. */}
                  {opt.disabled ? (
                    <span style={{ width: 16, flex: "0 0 auto" }} />
                  ) : (
                    <span
                      aria-hidden="true"
                      style={{
                        flex: "0 0 auto",
                        width: 16,
                        height: 16,
                        borderRadius: 3,
                        border: `1.5px solid ${
                          isSelected ? CREAM : "rgba(251,243,212,0.5)"
                        }`,
                        background: isSelected ? CREAM : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {isSelected && (
                        <svg width="11" height="11" viewBox="0 0 13 13">
                          <path
                            d="M2 7l3 3 6-7"
                            stroke={MENU_BG}
                            strokeWidth="2"
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                  )}
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {opt.label}
                  </span>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}
