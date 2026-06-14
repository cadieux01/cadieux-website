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
  /** Max height of the scrollable menu before it scrolls. */
  menuMaxHeight?: number;
  /** Defaults to true; the trigger fills its container. */
  fullWidth?: boolean;
}

const GOLD = "#c9a96e";
const CREAM = "#FBF3D4";
const MENU_BG = "#0e0e0e";

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
  menuMaxHeight = 280,
  fullWidth = true,
}: SelectProps) {
  const reactId = useId();
  const baseId = id ?? `sel-${reactId.replace(/[:]/g, "")}`;
  const listboxId = `${baseId}-listbox`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [flipUp, setFlipUp] = useState(false);

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

  // Decide whether to drop the menu above the trigger if it would overflow.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    setFlipUp(below < menuMaxHeight + 24 && rect.top > below);
  }, [open, menuMaxHeight]);

  // Keep the active option scrolled into view inside the menu.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  // Close on outside click / focus leaving the widget.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
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

  const triggerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    width: fullWidth ? "100%" : undefined,
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
    color: selectedLabel ? CREAM : "rgba(240,223,200,0.4)",
    boxShadow: open ? `0 0 0 2px rgba(201,169,110,0.25)` : "none",
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
            stroke={GOLD}
            strokeWidth="1.5"
            fill="none"
          />
        </svg>
      </button>

      {name !== undefined && (
        <input type="hidden" name={name} value={value} />
      )}

      {open && (
        <ul
          ref={menuRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          data-lenis-prevent
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            zIndex: 1000,
            margin: 0,
            padding: 4,
            listStyle: "none",
            background: MENU_BG,
            border: `1px solid ${GOLD}`,
            borderRadius: 8,
            boxShadow: "0 14px 40px rgba(0,0,0,0.55)",
            maxHeight: menuMaxHeight,
            overflowY: "auto",
            ...(flipUp
              ? { bottom: "calc(100% + 6px)" }
              : { top: "calc(100% + 6px)" }),
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
                  fontFamily: "var(--font-body)",
                  fontSize: 14,
                  fontWeight: 300,
                  letterSpacing: "0.03em",
                  lineHeight: 1.3,
                  color: opt.disabled
                    ? "rgba(251,243,212,0.32)"
                    : isSelected
                      ? GOLD
                      : CREAM,
                  background: opt.disabled
                    ? "transparent"
                    : isActive
                      ? "rgba(201,169,110,0.16)"
                      : isSelected
                        ? "rgba(201,169,110,0.08)"
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
                      stroke={GOLD}
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
        </ul>
      )}
    </div>
  );
}
