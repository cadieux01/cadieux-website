"use client";

// "Share list" — the whole filtered order slice, to a delivery partner on
// WhatsApp or onto paper.
//
// IT HAS NO FILTER CONTROLS OF ITS OWN, AND THAT IS THE POINT. The slice is
// whatever the board's own Status / Zone / Payment dropdown and DayFilter
// are currently showing: this component is handed the already-filtered rows
// and the URL those filters produced. A second filter model living inside a
// Share dialog is how the screen and the sheet start disagreeing — the
// failure /admin/orders/print already had twice (a `call:` filter it never
// read, then a zone filter it was never sent). So the only thing this
// control adds is a DESTINATION.
//
// What it states, before it sends: the day and basis, the filter in the
// admin's own words, and the live row count. An operator about to put 179
// addresses into someone's WhatsApp should be able to read what they are
// about to send without sending it first.
//
// Composition and chunking are both borrowed, not re-implemented:
// `composeRunSheet` builds the text (one `\n\n` block per order) and
// `PartnerShareButton` splits it on those boundaries and lists the
// `delivery_partners` rows. This component is wiring and a sentence.

import Link from "next/link";

import {
  PartnerShareButton,
  shareMenuItemStyle,
  type ShareablePartner,
} from "@/components/admin/PartnerShareButton";
import { formatDate } from "@/lib/admin-formatting";
import type { DateBasis } from "@/lib/day-filter";
import { composeRunSheet, type RunSheetOrder } from "@/lib/order-run-sheet";

export function ShareListButton({
  orders,
  basis,
  day,
  filterLabel,
  query,
  /** The board's own query string, verbatim — see the note on the Link below. */
  search,
  partners,
  partnersLoading,
  partnersError,
  buttonStyle,
}: {
  orders: readonly RunSheetOrder[];
  basis: DateBasis;
  day: string | null;
  /** The filter groups as the dropdown words them, or "all". */
  filterLabel: string;
  query: string;
  search: string;
  partners: ShareablePartner[];
  partnersLoading: boolean;
  partnersError: string | null;
  buttonStyle: React.CSSProperties;
}) {
  const basisLabel = basis === "delivery" ? "by delivery date" : "by order date";
  const dayLabel = day
    ? `${formatDate(day)} (${basisLabel})`
    : `all dates (${basisLabel})`;

  const message = composeRunSheet(orders, basis, {
    dayLabel,
    filterLabel,
    query,
  });

  // An empty slice must not be sendable. The header alone would read as a
  // run with no stops, which a partner could easily take for a short day
  // rather than a mis-set filter.
  const blockedReason =
    orders.length === 0
      ? `Nothing to share — no orders match ${dayLabel} · ${filterLabel}.`
      : null;

  return (
    <PartnerShareButton
      message={message}
      partners={partners}
      partnersLoading={partnersLoading}
      partnersError={partnersError}
      buttonStyle={buttonStyle}
      buttonLabel={`Share list (${orders.length})`}
      blockedReason={blockedReason}
      footer={
        // THE BOARD'S OWN QUERY STRING, passed through unchanged. Not a
        // query object rebuilt here: that is exactly how the Print link
        // came to be missing ?zone for months. `search` is the same string
        // the address bar is showing, so the printed set equals the screen's
        // set by construction, and any group added to the URL codec later
        // rides along without an edit here.
        <Link
          href={`/admin/orders/run-sheet?${search}`}
          target="_blank"
          rel="noopener noreferrer"
          style={shareMenuItemStyle}
        >
          <span>Print run sheet</span>
          <span style={{ color: "rgba(251,243,212,0.6)", fontSize: "1rem" }}>
            {orders.length} order{orders.length === 1 ? "" : "s"}
          </span>
        </Link>
      }
    />
  );
}
