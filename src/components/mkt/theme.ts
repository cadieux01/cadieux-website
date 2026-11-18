// /mkt palette. Used by MktShell + the three-pane CRM. Deliberately
// separate from the /admin theme file (src/components/admin/theme.ts)
// because /mkt is NOT the admin surface — admin is dark + austere,
// /mkt is light + on brand. If ever these need to converge they can
// re-export; today the whole point is they do not.
//
// Role is encoded in the KEY, not the colour. Changing cream to a
// warmer cream later is one edit; changing "the one blue we use" to a
// different hue is one edit. Hex-picking in a component file is how
// brand palettes rot.

export const MKT = {
  /** Page surface. Grain Cream. */
  cream: "#FBF3D4",
  /** Primary. Foundation Green — headers, active segment, strong CTAs. */
  green: "#024628",
  /** Accent. Endurance Blue — links and interactive highlights only.
   *  Reserved: do NOT use it as a background for a full section. */
  blue: "#4369B2",
  /** Body text. Core Black. */
  ink: "#1D1D1F",
  /** Borders + dividers + muted text at ~70%. Clean Ash. */
  ash: "#C0C8CE",
  /** Muted text (dates, metadata). ~45% ink against cream. */
  mute: "rgba(29,29,31,0.6)",
  /** Hover tint — a 6% green wash. Picked so the 1.4 contrast against
   *  cream reads as a lift without competing with the active state's
   *  solid green. */
  hover: "rgba(2,70,40,0.06)",
  /** Pressed tint — slightly deeper hover, same hue. */
  pressed: "rgba(2,70,40,0.12)",
  /** Error surface — keeps distance from both green and the base ash
   *  border. Used for <PaneError>. */
  error: "#B3261E",
  errorBg: "rgba(179,38,30,0.08)",
  /** Active chip fill = green; active chip text = cream (legible at
   *  ~10:1). Codified here so no component picks a different pair. */
  activeBg: "#024628",
  activeFg: "#FBF3D4",
  /** Soft shadow for the card surfaces. Y-offset only, low blur — a
   *  sharper edge than a Material-style shadow reads as "crisper"
   *  without sitting proud of the cream page. */
  cardShadow:
    "0 1px 0 rgba(29,29,31,0.04), 0 4px 10px -4px rgba(29,29,31,0.08)",
} as const;
