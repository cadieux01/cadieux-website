// Zone pill shown on every row of the orders / subscriptions boards, on
// the print sheet and in the share message. It is a purely derived value
// (see src/lib/delivery-zones.ts) — the caller resolves the zone once and
// hands us the key.
//
// The four numbered zones share the cream family so the badge reads as
// "informational" rather than as a stage. Unzoned is dimmer — an unzoned
// row is a live gap in the map and should be noticeable without being
// alarming. Pickup carries a border tint (not a fill) to distinguish it
// from the four delivery zones without stealing attention from the status
// badge above it.

import { ZONE_LABELS, type ZoneKey } from "@/lib/delivery-zones";

const COLOR_BY_ZONE: Record<ZoneKey, { fg: string; border: string }> = {
  zone1: { fg: "#FBF3D4", border: "rgba(251,243,212,0.45)" },
  zone2: { fg: "#FBF3D4", border: "rgba(251,243,212,0.45)" },
  zone3: { fg: "#FBF3D4", border: "rgba(251,243,212,0.45)" },
  zone4: { fg: "#FBF3D4", border: "rgba(251,243,212,0.45)" },
  unzoned: { fg: "rgba(251,243,212,0.7)", border: "rgba(251,243,212,0.3)" },
  pickup: { fg: "#FBF3D4", border: "rgba(251,243,212,0.6)" },
};

export function ZoneBadge({
  zone,
  compact = false,
}: {
  zone: ZoneKey | null | undefined;
  compact?: boolean;
}) {
  if (!zone) return null;
  const colors = COLOR_BY_ZONE[zone];
  return (
    <span
      className="inline-flex items-center uppercase"
      style={{
        fontFamily: "var(--font-body)",
        fontSize: compact ? "0.75rem" : "0.85rem",
        letterSpacing: "0.16em",
        color: colors.fg,
        border: `1px solid ${colors.border}`,
        padding: compact ? "0.1rem 0.45rem" : "0.15rem 0.55rem",
        borderRadius: "999px",
        whiteSpace: "nowrap",
      }}
    >
      {ZONE_LABELS[zone]}
    </span>
  );
}
