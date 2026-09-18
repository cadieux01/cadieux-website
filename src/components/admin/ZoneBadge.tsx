// Zone pill shown on every row of the orders / subscriptions boards, on
// the print sheet and in the share message.
//
// The badge is now a click target on the boards — clicking it opens the
// ZoneAssignPopover (see src/components/admin/ZoneAssignPopover.tsx). On
// non-interactive surfaces (print, share) the caller omits onClick and it
// renders as an inert span, exactly as before.
//
// A `source` prop tells the badge WHERE the zone came from. Any override
// or learned rule gets a small dot before the label — the operator must
// be able to see at a glance which rows are running under their own rules
// and which are still on the built-in map. The dot is not a description
// of the zone (which would violate labels-only) but a description of the
// PROVENANCE of the zone. That is what the whole feature is for.

import type { ZoneKey, ZoneSource } from "@/lib/delivery-zones";
import { ZONE_LABELS } from "@/lib/delivery-zones";

const COLOR_BY_ZONE: Record<ZoneKey, { fg: string; border: string }> = {
  zone1: { fg: "#FBF3D4", border: "rgba(251,243,212,0.45)" },
  zone2: { fg: "#FBF3D4", border: "rgba(251,243,212,0.45)" },
  zone3: { fg: "#FBF3D4", border: "rgba(251,243,212,0.45)" },
  zone4: { fg: "#FBF3D4", border: "rgba(251,243,212,0.45)" },
  unzoned: { fg: "rgba(251,243,212,0.7)", border: "rgba(251,243,212,0.3)" },
  pickup: { fg: "#FBF3D4", border: "rgba(251,243,212,0.6)" },
};

function isProvenanceSource(source: ZoneSource | undefined): boolean {
  return (
    source === "row_override" ||
    source === "rule_pincode" ||
    source === "rule_locality"
  );
}

export function ZoneBadge({
  zone,
  compact = false,
  source,
  onClick,
}: {
  zone: ZoneKey | null | undefined;
  compact?: boolean;
  /** Which ladder step produced this zone. Optional so the print sheet
   *  and the share message — which do not care about provenance — can
   *  keep calling `<ZoneBadge zone={z} />` unchanged. */
  source?: ZoneSource;
  /** When provided, the badge becomes a button. Omitted on print/share. */
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
}) {
  if (!zone) return null;
  const colors = COLOR_BY_ZONE[zone];
  const showDot = isProvenanceSource(source);
  const interactive = typeof onClick === "function" && zone !== "pickup";
  // Content is the same shape whether it's a span or a button — CSS reset
  // on the button keeps the visual identical.
  const inner = (
    <>
      {showDot ? (
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: compact ? "0.32rem" : "0.38rem",
            height: compact ? "0.32rem" : "0.38rem",
            borderRadius: "999px",
            background: colors.fg,
            marginRight: compact ? "0.32rem" : "0.4rem",
            opacity: 0.9,
          }}
        />
      ) : null}
      {ZONE_LABELS[zone]}
    </>
  );
  const style: React.CSSProperties = {
    fontFamily: "var(--font-body)",
    fontSize: compact ? "0.75rem" : "0.85rem",
    letterSpacing: "0.16em",
    color: colors.fg,
    border: `1px solid ${colors.border}`,
    padding: compact ? "0.1rem 0.45rem" : "0.15rem 0.55rem",
    borderRadius: "999px",
    whiteSpace: "nowrap",
    background: "transparent",
    cursor: interactive ? "pointer" : "default",
  };
  if (!interactive) {
    return (
      <span className="inline-flex items-center uppercase" style={style}>
        {inner}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="inline-flex items-center uppercase"
      onClick={onClick}
      style={style}
      aria-label={`Zone: ${ZONE_LABELS[zone]}. Click to change.`}
    >
      {inner}
    </button>
  );
}
