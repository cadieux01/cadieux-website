"use client";

// Orders ⇄ Subscriptions, as one control.
//
// The two boards answer the same operator question about two different
// things ("what is due, to whom, where"), and before this the only way
// across was the sidebar — which loses the filter you had just set. Setting
// a date, picking a zone, then re-setting both on the other board is how the
// two come to be read against different windows.
//
// IT NAVIGATES. It does not host the other board inside this one. Rendering
// both tables on one route would need SubscriptionsBoard lifted out of its
// page module, and two boards mounted together would each run their own
// useUrlWriteback against one pathname — each reading the other's query
// string as "not mine" and replacing it, which is a render loop, not a race.
// A soft navigation costs one route transition and keeps both boards exactly
// as they are.
//
// WHAT CROSSES, AND WHAT DOES NOT. The date filter (`date` / `span` /
// `basis`), the zone and the search text carry over: all three mean the same
// thing on both boards, which is the whole point of day-filter.ts and
// delivery-zones.ts being shared modules.
//
// `status` deliberately does NOT carry. The enums are disjoint — an order is
// `pending` / `preparing` / `delivered`, a subscription is `active` /
// `paused` / `payment_pending` — so forwarding it would hand the other board
// a value it cannot match and silently empty it. An empty board that looks
// broken is worse than a filter the operator re-picks, and carrying a value
// the destination has no option for would also leave its dropdown pointing
// at something not in its own list.

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import Select from "@/components/ui/Select";

export type BoardKey = "orders" | "subscriptions";

const PATHS: Record<BoardKey, string> = {
  orders: "/admin/orders",
  subscriptions: "/admin/subscriptions",
};

/** The params that mean the same thing on both boards. Anything not listed
 *  here is dropped on the way across, by construction rather than by a
 *  blocklist someone has to remember to extend. */
const SHARED_PARAMS = ["date", "span", "basis", "zone", "q"] as const;

export type BoardSwitcherProps = {
  /** Which board is being rendered. */
  current: BoardKey;
  /** The board's own query string — the SAME one it writes to the URL, so
   *  what crosses over is what the operator is looking at, not a second
   *  params object assembled nearby. */
  search: string;
};

export function BoardSwitcher({ current, search }: BoardSwitcherProps) {
  const router = useRouter();

  const go = useCallback(
    (next: string) => {
      if (next === current) return;
      const from = new URLSearchParams(search);
      const to = new URLSearchParams();
      for (const k of SHARED_PARAMS) {
        const v = from.get(k);
        if (v) to.set(k, v);
      }
      const qs = to.toString();
      const path = PATHS[next as BoardKey];
      router.push(qs ? `${path}?${qs}` : path);
    },
    [current, router, search],
  );

  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: "0.25rem",
        minWidth: 0,
      }}
    >
      <label
        htmlFor="admin-board-switch"
        style={{
          color: "rgba(251,243,212,0.7)",
          fontFamily: "var(--font-body)",
          fontSize: "0.75rem",
          letterSpacing: "0.15em",
          textTransform: "uppercase",
        }}
      >
        Showing
      </label>
      <Select
        id="admin-board-switch"
        value={current}
        ariaLabel="Which board to show"
        onChange={go}
        options={[
          { value: "orders", label: "Orders" },
          { value: "subscriptions", label: "Subscriptions" },
        ]}
      />
    </div>
  );
}
