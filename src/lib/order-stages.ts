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

export type OrderStage = (typeof ORDER_STAGES)[number];

export const STAGE_LABEL: Record<OrderStage, string> = {
  placed: "Placed",
  confirmed: "Confirmed",
  preparing: "Preparing",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
};

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
    default:
      return null;
  }
}

export function stageIndex(stage: OrderStage): number {
  return ORDER_STAGES.indexOf(stage);
}

export function isCancelled(status: string | null | undefined): boolean {
  return (status ?? "").toLowerCase() === "cancelled";
}
