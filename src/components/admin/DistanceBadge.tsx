"use client";

// Small chip under the address showing distance from the sort anchor and
// WHICH LOCATOR produced it. Shared by /admin/orders and
// /admin/subscriptions.
//
// The precision is on the chip on purpose. A bare "3.2 km" reads as a
// measurement; half of these are the distance to a pincode centroid,
// which on 530017 is over a kilometre from some of the doors in it. A
// rider planning a run needs to know which of the two numbers in front
// of him he can trust — hence ~PIN in amber against GPS in cream.

import type { DistanceInfo } from "@/lib/distance-sort";

export function DistanceBadge({ info }: { info: DistanceInfo }) {
  const base: React.CSSProperties = {
    display: "inline-block",
    marginTop: 6,
    padding: "2px 6px",
    fontFamily: "var(--font-body)",
    fontSize: "0.75rem",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    borderRadius: 999,
    border: "1px solid",
  };
  if (info.precision === "none" || info.km === null) {
    return (
      <div
        style={{
          ...base,
          color: "rgba(251,243,212,0.55)",
          borderColor: "rgba(251,243,212,0.25)",
        }}
        title="No saved coordinates and no pincode we can place"
      >
        No location
      </div>
    );
  }
  const km = info.km >= 10 ? info.km.toFixed(0) : info.km.toFixed(1);
  if (info.precision === "gps") {
    return (
      <div
        style={{
          ...base,
          color: "#FBF3D4",
          borderColor: "rgba(251,243,212,0.5)",
        }}
        title="Saved coordinates — exact distance"
      >
        {km} km · GPS
      </div>
    );
  }
  return (
    <div
      style={{
        ...base,
        color: "#F59E0B",
        borderColor: "rgba(245,158,11,0.55)",
      }}
      title="No saved coordinates — distance to the pincode centroid, not the doorstep"
    >
      ~{km} km · PIN
    </div>
  );
}
