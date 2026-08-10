// Tiny status pill shared across orders / subscriptions / deliveries.
// Colours are picked to map order-life-cycle progression onto a
// muted gold spectrum, with red for cancelled and green for delivered.

const COLOR_BY_STATUS: Record<string, { fg: string; border: string }> = {
  // orders — canonical stages
  placed: { fg: "rgba(245,158,11,0.85)", border: "rgba(245,158,11,0.35)" },
  confirmed: { fg: "#fbf3d4", border: "rgba(251,243,212,0.45)" },
  preparing: { fg: "#fcd34d", border: "rgba(252,211,77,0.5)" },
  out_for_delivery: { fg: "#86efac", border: "rgba(134,239,172,0.5)" },
  delivered: { fg: "#4ade80", border: "rgba(74,222,128,0.55)" },
  cancelled: { fg: "#ef4444", border: "rgba(239,68,68,0.5)" },
  // pickup-only stages — reuse the "ready to hand over" green family so
  // ready_for_pickup sits visually between confirmed (cream) and picked_up
  // (delivered-green).
  ready_for_pickup: { fg: "#86efac", border: "rgba(134,239,172,0.5)" },
  picked_up: { fg: "#4ade80", border: "rgba(74,222,128,0.55)" },
  // legacy aliases (rendered for any rows the migration hasn't touched yet)
  pending: { fg: "rgba(245,158,11,0.85)", border: "rgba(245,158,11,0.35)" },
  pending_payment: { fg: "#f59e0b", border: "rgba(245,158,11,0.45)" },
  dispatched: { fg: "#86efac", border: "rgba(134,239,172,0.5)" },
  // subscriptions
  active: { fg: "#4ade80", border: "rgba(74,222,128,0.5)" },
  paused: { fg: "#fbbf24", border: "rgba(251,191,36,0.5)" },
  completed: { fg: "#a5b4fc", border: "rgba(165,180,252,0.5)" },
  // delivery (subscription_deliveries)
  pending_confirmation: { fg: "rgba(245,158,11,0.85)", border: "rgba(245,158,11,0.35)" },
  // payment
  paid: { fg: "#4ade80", border: "rgba(74,222,128,0.5)" },
  failed: { fg: "#ef4444", border: "rgba(239,68,68,0.5)" },
  refunded: { fg: "#a5b4fc", border: "rgba(165,180,252,0.5)" },
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const key = (status ?? "").toLowerCase();
  const colors = COLOR_BY_STATUS[key] ?? {
    fg: "rgba(192,200,206,0.7)",
    border: "rgba(192,200,206,0.35)",
  };
  return (
    <span
      className="inline-flex items-center uppercase"
      style={{
        fontFamily: "var(--font-body)",
        fontSize: "0.6rem",
        letterSpacing: "0.18em",
        color: colors.fg,
        border: `1px solid ${colors.border}`,
        padding: "0.18rem 0.55rem",
        borderRadius: "999px",
        whiteSpace: "nowrap",
      }}
    >
      {key || "—"}
    </span>
  );
}
