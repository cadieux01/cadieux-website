// Canonical order-status progression used by:
//   - the customer Track Order page (/orders/[id]) visual tracker
//   - the admin orders page status dropdown
//   - the StatusBadge colour map
//
// Legacy values that pre-date the order-status-stages migration
// (`pending`, `dispatched`) get normalised here so any old rows still
// render correctly on the tracker without forcing a backfill.

export const ORDER_STAGES = [
  "placed",
  "confirmed",
  "preparing",
  "out_for_delivery",
  "delivered",
] as const;

// Pickup-only stage progression (Phase 1 pickup-from-stall). Used by the
// tracker when order.fulfillment_type === 'pickup'. Same "placed → confirmed"
// prefix as delivery, then diverges: no preparing/out_for_delivery — the
// operator marks the loaves ready to collect, and the customer collects.
export const PICKUP_STAGES = [
  "placed",
  "confirmed",
  "ready_for_pickup",
  "picked_up",
] as const;

export type OrderStage =
  | (typeof ORDER_STAGES)[number]
  | (typeof PICKUP_STAGES)[number];

export const STAGE_LABEL: Record<string, string> = {
  placed: "Placed",
  confirmed: "Confirmed",
  preparing: "Preparing",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  ready_for_pickup: "Ready to Pick Up",
  picked_up: "Picked Up",
};

/** Which stage array applies to a given fulfillment_type. */
export function stagesFor(
  fulfillment: string | null | undefined,
): readonly OrderStage[] {
  return (fulfillment ?? "").toLowerCase() === "pickup"
    ? PICKUP_STAGES
    : ORDER_STAGES;
}

// Map any raw status string to a canonical stage (or null for
// non-tracker states like `cancelled` / `pending_payment`).
export function toStage(status: string | null | undefined): OrderStage | null {
  if (!status) return null;
  const s = status.toLowerCase();
  switch (s) {
    case "placed":
    case "pending":
      return "placed";
    case "confirmed":
      return "confirmed";
    case "preparing":
      return "preparing";
    case "out_for_delivery":
    case "dispatched":
      return "out_for_delivery";
    case "delivered":
    case "completed":
      return "delivered";
    case "ready_for_pickup":
      return "ready_for_pickup";
    case "picked_up":
      return "picked_up";
    default:
      return null;
  }
}

/** Index of a stage within a specific stage-set (defaults to delivery). */
export function stageIndex(
  stage: OrderStage,
  stages: readonly OrderStage[] = ORDER_STAGES,
): number {
  return stages.indexOf(stage);
}

export function isCancelled(status: string | null | undefined): boolean {
  return (status ?? "").toLowerCase() === "cancelled";
}
