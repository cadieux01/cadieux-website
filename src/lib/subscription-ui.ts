// Shared display helpers for the customer-facing subscription pages.

export const GOLD = "#024628";

export const DAY_LABEL: Record<string, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday",
  thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday",
};

export const DELIVERY_STATUS_LABEL: Record<string, string> = {
  pending_confirmation: "Pending",
  confirmed: "Confirmed",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const DELIVERY_STATUS_COLOR: Record<string, string> = {
  pending_confirmation: "rgba(240,223,200,0.4)",
  confirmed: "#e3b341",
  out_for_delivery: "#5fa8ff",
  delivered: GOLD,
  cancelled: "#ff8181",
};

export const SUB_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function isCompleted(status: string): boolean {
  return status === "delivered";
}

export function isInProgress(status: string): boolean {
  return status === "out_for_delivery";
}
