// Single source of truth for the /admin palette.
//
// The admin is TWO COLORS. Nothing else belongs in here and nothing else
// belongs in any file under src/app/admin or src/components/admin.
//
//   INK   #1D1D1F  — the page
//   CREAM #FBF3D4  — everything written on the page
//
// The only exception is DANGER, reserved for destructive actions (Archive,
// Delete) where colour is a safety signal rather than decoration.
//
// Why this file exists: the palette used to be re-declared per page (GOLD,
// DARK_GREEN, FADED, NAV_BG, ASH...), which is how dark green labels ended up
// on a near-black background — unreadable, and invisible to any single-file
// fix. Import from here instead of writing a literal.

export const INK = "#1D1D1F";
export const CREAM = "#FBF3D4";

/** Alpha ramp on CREAM. Used for muted text, borders and hover fills. */
export const cream = (alpha: number) => `rgba(251, 243, 212, ${alpha})`;
/** Alpha ramp on INK. Used for shadows and text on cream surfaces. */
export const ink = (alpha: number) => `rgba(29, 29, 31, ${alpha})`;

// ---- Roles on the INK page ----
export const PAGE_BG = INK;
export const TEXT = CREAM;
/** Helper / hint / secondary copy. Weight 500 at the call site. */
export const TEXT_MUTED = cream(0.7);
/** Inactive tabs, disabled controls. */
export const TEXT_FADED = cream(0.6);
export const BORDER = cream(0.35);
/** Hairlines between table rows and inside panels. */
export const BORDER_SUBTLE = cream(0.18);
/** Hover / selected row wash on the INK page. */
export const HOVER_BG = cream(0.08);
export const SHADOW = ink(0.45);

// ---- Roles on a CREAM surface (cards, panels, inputs) ----
export const SURFACE_BG = CREAM;
export const SURFACE_TEXT = INK;
export const SURFACE_TEXT_MUTED = ink(0.7);
export const SURFACE_BORDER = ink(0.25);

// ---- Form fields ----
export const INPUT_BG = CREAM;
export const INPUT_TEXT = INK;
export const INPUT_BORDER = CREAM;
export const INPUT_CARET = INK;
export const INPUT_PLACEHOLDER = ink(0.5);
/** 2px ring, replaces the browser's blue focus outline. */
export const FOCUS_RING = CREAM;

// ---- Destructive only ----
export const DANGER = "#EF4444";
export const DANGER_BORDER = "rgba(239, 68, 68, 0.5)";
export const DANGER_BG = "rgba(239, 68, 68, 0.12)";
