// Tiny status pill shared across orders / subscriptions / deliveries.
//
// The admin is two colours, so life-cycle progression is no longer encoded
// in hue (it used to run a gold spectrum, green for delivered, red for
// cancelled). Stages are separated by CREAM opacity and border weight
// instead: early stages at 0.85 text / 0.35 border, mid stages at full
// cream with a 0.45-0.5 border, terminal stages at 0.55, and the computed
// `expired` state deliberately dimmer so it reads as inert. Red survives
// only on cancelled / failed, where colour is a warning, not decoration.

const COLOR_BY_STATUS: Record<string, { fg: string; border: string }> = {
  // orders — canonical stages
  placed: { fg: "rgba(251,243,212,0.85)", border: "rgba(251,243,212,0.35)" },
  confirmed: { fg: "#FBF3D4", border: "rgba(251,243,212,0.45)" },
  preparing: { fg: "#FBF3D4", border: "rgba(251,243,212,0.5)" },
  out_for_delivery: { fg: "#FBF3D4", border: "rgba(251,243,212,0.5)" },
  delivered: { fg: "#FBF3D4", border: "rgba(251,243,212,0.55)" },
  cancelled: { fg: "#EF4444", border: "rgba(239,68,68,0.5)" },
  // pickup-only stages — reuse the "ready to hand over" green family so
  // ready_for_pickup sits visually between confirmed (cream) and picked_up
  // (delivered-green).
  ready_for_pickup: { fg: "#FBF3D4", border: "rgba(251,243,212,0.5)" },
  picked_up: { fg: "#FBF3D4", border: "rgba(251,243,212,0.55)" },
  // legacy aliases (rendered for any rows the migration hasn't touched yet)
  pending: { fg: "rgba(251,243,212,0.85)", border: "rgba(251,243,212,0.35)" },
  pending_payment: { fg: "#FBF3D4", border: "rgba(251,243,212,0.45)" },
  dispatched: { fg: "#FBF3D4", border: "rgba(251,243,212,0.5)" },
  // computed lifecycle state — stale unpaid pending/placed >7d, per
  // src/lib/order-state.ts. Muted grey so it reads as "inert" (not scary
  // red, since it's just an abandoned COD, not something to act on).
  expired: { fg: "rgba(251,243,212,0.75)", border: "rgba(251,243,212,0.4)" },
  // subscriptions
  active: { fg: "#FBF3D4", border: "rgba(251,243,212,0.5)" },
  paused: { fg: "#FBF3D4", border: "rgba(251,243,212,0.5)" },
  completed: { fg: "#FBF3D4", border: "rgba(251,243,212,0.5)" },
  // delivery (subscription_deliveries)
  pending_confirmation: { fg: "rgba(251,243,212,0.85)", border: "rgba(251,243,212,0.35)" },
  // payment
  paid: { fg: "#FBF3D4", border: "rgba(251,243,212,0.5)" },
  failed: { fg: "#EF4444", border: "rgba(239,68,68,0.5)" },
  refunded: { fg: "#FBF3D4", border: "rgba(251,243,212,0.5)" },
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const key = (status ?? "").toLowerCase();
  const colors = COLOR_BY_STATUS[key] ?? {
    fg: "rgba(251,243,212,0.7)",
    border: "rgba(251,243,212,0.35)",
  };
  return (
    <span
      className="inline-flex items-center uppercase"
      style={{
        fontFamily: "var(--font-body)",
        fontSize: "0.875rem",
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
