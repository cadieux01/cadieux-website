"use client";

// Compact per-row note trigger: sticky-note icon + count.
//
//   • count === 0 → outline icon, no badge.
//   • count > 0   → filled icon + numeric badge in the corner.
//
// Only rendering — the click handler is the caller's, which opens the
// shared NotePanel with the correct owner ({order_id} or
// {subscription_id}).

import { BORDER, CREAM, TEXT_MUTED } from "./theme";

type Props = {
  count: number;
  onClick: () => void;
  ariaLabel?: string;
};

export function NoteIconButton({ count, onClick, ariaLabel }: Props) {
  const filled = count > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={
        ariaLabel ?? (count === 0 ? "Add note" : `Open notes (${count})`)
      }
      title={count === 0 ? "Add note" : `${count} note${count === 1 ? "" : "s"}`}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        padding: 0,
        background: "transparent",
        border: `1px solid ${filled ? "rgba(251,243,212,0.6)" : BORDER}`,
        borderRadius: 4,
        color: filled ? CREAM : TEXT_MUTED,
        cursor: "pointer",
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {/* Sticky-note shape with a dog-eared corner. */}
        <path d="M4 4h11l5 5v11a0 0 0 0 1 0 0H4z" />
        <path d="M15 4v5h5" />
      </svg>
      {count > 0 ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: -6,
            right: -6,
            minWidth: 16,
            height: 16,
            padding: "0 4px",
            borderRadius: 8,
            background: CREAM,
            color: "#024628",
            fontSize: 10,
            fontWeight: 700,
            lineHeight: "16px",
            textAlign: "center",
            letterSpacing: 0,
          }}
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </button>
  );
}
