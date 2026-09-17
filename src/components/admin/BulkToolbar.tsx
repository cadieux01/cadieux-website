// The sticky bar that appears once rows are ticked.
//
// Deliberately knows nothing about orders or subscriptions — it is handed a
// count and a list of actions, and reports clicks back. The two boards do NOT
// offer the same actions (a subscription has no bulk Cancel; cancelling a
// standing plan is a per-plan decision with deliveries hanging off it), so
// the action list is a prop rather than a constant in here. What they DO
// share is the thing worth sharing: where the bar sits, that it stays visible
// while the operator scrolls the rows they picked, and that every button in
// it goes dead together while something is running.

import type React from "react";

export type BulkActionSpec<A extends string> = {
  id: A;
  label: string;
  /** Renders red. For actions that write to the DB or reach a customer. */
  danger?: boolean;
};

export function BulkToolbar<A extends string>({
  count,
  actions,
  running,
  onClear,
  onAction,
}: {
  count: number;
  actions: readonly BulkActionSpec<A>[];
  running: boolean;
  onClear: () => void;
  onAction: (a: A) => void;
}) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 5,
        display: "flex",
        flexWrap: "wrap",
        gap: "0.6rem",
        alignItems: "center",
        background: "rgba(251,243,212,0.1)",
        border: "1px solid rgba(251,243,212,0.4)",
        padding: "0.6rem 0.9rem",
        marginBottom: "1rem",
      }}
    >
      <span
        style={{
          color: "#FBF3D4",
          fontFamily: "var(--font-body)",
          fontSize: "1rem",
          letterSpacing: "0.05em",
        }}
      >
        {count} selected
      </span>
      <span style={{ flex: 1 }} />
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onAction(a.id)}
          disabled={running}
          style={{
            ...bulkButton,
            color: a.danger ? "#EF4444" : "#FBF3D4",
            borderColor: a.danger
              ? "rgba(239,68,68,0.45)"
              : "rgba(251,243,212,0.45)",
            opacity: running ? 0.5 : 1,
          }}
        >
          {a.label}
        </button>
      ))}
      <button
        type="button"
        onClick={onClear}
        disabled={running}
        style={{
          ...bulkButton,
          color: "rgba(251,243,212,0.65)",
          borderColor: "rgba(251,243,212,0.3)",
        }}
      >
        Clear
      </button>
    </div>
  );
}

const bulkButton: React.CSSProperties = {
  padding: "0.4rem 0.85rem",
  background: "transparent",
  border: "1px solid rgba(251,243,212,0.45)",
  fontFamily: "var(--font-body)",
  fontSize: "0.875rem",
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  cursor: "pointer",
};
