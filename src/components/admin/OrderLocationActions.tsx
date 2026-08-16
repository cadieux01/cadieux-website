"use client";

// Three-action location block shown on every order row in the admin
// Today's Orders view when the order has captured lat/lng:
//
//   1. Tappable Google Maps link → opens the pinned location in a new tab.
//   2. Copy button → copies the same maps URL to clipboard with brief
//      "Copied!" feedback (uses navigator.clipboard, falls back silently).
//   3. WhatsApp share → opens wa.me with a prefilled message containing
//      a short label + the maps URL, so the operator can paste it to
//      the delivery rider in one tap.
//
// Server is the source of truth; this component is pure presentation —
// it never sends anything back to the backend.
//
// Styling matches the gold/cream palette used across admin (see
// ContactActions). Touch targets are 28px so delivery staff using a
// phone in the field can hit them reliably.

import { useState } from "react";

import { formatOrderNumber } from "@/lib/order-number";

const GOLD = "#f59e0b";
const CREAM = "#fbf3d4";
const BORDER = "rgba(245,158,11,0.35)";
const MUTED = "rgba(192,200,206,0.55)";

export function OrderLocationActions({
  latitude,
  longitude,
  orderId,
  orderNumber,
  stopPropagation = true,
}: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  /** Short order id used in the WhatsApp prefill text. */
  orderId: string;
  /** Human-facing order number (OLF…). Preferred over id-slice fallback. */
  orderNumber?: string | null;
  /** When inside a clickable row, swallow the click. Matches ContactActions. */
  stopPropagation?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    (latitude === 0 && longitude === 0)
  ) {
    return (
      <div
        style={{
          marginTop: 6,
          color: MUTED,
          fontSize: "0.7rem",
          letterSpacing: "0.05em",
          fontStyle: "italic",
        }}
      >
        No location shared
      </div>
    );
  }

  const mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
  const shortId = formatOrderNumber({ id: orderId, order_number: orderNumber });
  const waText = `Cadieux delivery location for order ${shortId}: ${mapsUrl}`;
  const waUrl = `https://wa.me/?text=${encodeURIComponent(waText)}`;

  const guard = (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
  };

  async function handleCopy(e: React.MouseEvent) {
    guard(e);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(mapsUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // Permission denied or unsupported — leave silent so the link
      // and WhatsApp options remain usable.
    }
  }

  const buttonStyle: React.CSSProperties = {
    minWidth: 28,
    height: 28,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: `1px solid ${BORDER}`,
    background: "transparent",
    color: GOLD,
    cursor: "pointer",
    padding: "0 8px",
    fontFamily: "var(--font-body)",
    fontSize: "0.7rem",
    letterSpacing: "0.1em",
    textDecoration: "none",
    textTransform: "uppercase",
  };

  return (
    <div
      style={{
        marginTop: 6,
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
      }}
      onClick={guard}
      onMouseDown={guard}
    >
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Open in Google Maps"
        aria-label="Open delivery location in Google Maps"
        style={{ ...buttonStyle, gap: 4, color: CREAM, borderColor: BORDER }}
        onClick={guard}
      >
        <PinIcon size={14} />
        <span>Map</span>
      </a>
      <button
        type="button"
        title={copied ? "Copied!" : "Copy maps link"}
        aria-label="Copy maps link"
        style={buttonStyle}
        onClick={handleCopy}
      >
        {copied ? "Copied!" : "Copy"}
      </button>
      <a
        href={waUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Share via WhatsApp"
        aria-label="Share delivery location via WhatsApp"
        style={buttonStyle}
        onClick={guard}
      >
        WhatsApp
      </a>
    </div>
  );
}

function PinIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
