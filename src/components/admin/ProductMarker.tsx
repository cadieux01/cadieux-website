// Coloured square + letter, naming a product at a glance.
//
// Built generic — (kind, label, tone) — because the same marker is wanted
// for other axes later (veg / non-veg on the sandwich board). Nothing here
// knows about bread; the bread mapping lives in PRODUCT_TONES below and is
// the only part that would change.
//
// TONES. Plain green, Multigrain amber. Amber and NOT red: #EF4444 appears
// 101 times across this admin and means destructive every time — cancel,
// delete, the failure line on a bulk result. A colour that means "you are
// about to lose something" must not also mean "this bag has multigrain in
// it", or the operator learns to discount it.
//
// KNOWN INCONSISTENCY, deliberately not fixed here: components/admin/
// LoafDots.tsx paints Multigrain #D6453F (red) on every /admin/orders row,
// under the same reasoning this rejects. Changing that repaints a board
// this branch was not asked to touch, so it is reported rather than
// silently reconciled. If it is reconciled later, LoafDots should import
// PRODUCT_TONES from here instead of declaring its own constants.

import type { CSSProperties } from "react";
import { DAY_LABEL } from "@/lib/subscription-ui";
import type { CountLine } from "@/lib/subscription-counts";

export type MarkerTone = "green" | "amber" | "neutral";

export const TONE_COLOURS: Record<MarkerTone, { bg: string; fg: string }> = {
  // Cream text on the two saturated fills; the admin body colour is
  // #FBF3D4, so the letter reads as part of the page rather than as a
  // second accent.
  green: { bg: "#3FBF6A", fg: "#0F1A18" },
  amber: { bg: "#F59E0B", fg: "#0F1A18" },
  // A product we have no tone for: hollow, never a guessed colour. An
  // unknown bread silently rendering as Plain is exactly the class of bug
  // this whole branch exists to remove.
  neutral: { bg: "transparent", fg: "#FBF3D4" },
};

/** slug → tone. The ONLY bread-aware line in this file. */
export const PRODUCT_TONES: Record<string, MarkerTone> = {
  "high-protein": "green",
  multigrain: "amber",
};

export function toneForProduct(slug: string): MarkerTone {
  return PRODUCT_TONES[slug] ?? "neutral";
}

/**
 * One marker. `label` is the full human name ("Plain") — the square shows
 * its first letter, the title attribute and the screen-reader label carry
 * the whole thing, so "P" is never the only way to tell them apart.
 */
export function ProductMarker({
  label,
  tone,
  count,
  title,
  size = 16,
}: {
  label: string;
  tone: MarkerTone;
  /** Rendered beside the square when given. Omit for a bare marker. */
  count?: number;
  /** Overrides the default "<label> <count>" tooltip. */
  title?: string;
  size?: number;
}) {
  const { bg, fg } = TONE_COLOURS[tone];
  const text =
    title ?? (typeof count === "number" ? `${label} ${count}` : label);
  const square: CSSProperties = {
    width: size,
    height: size,
    borderRadius: 3,
    background: bg,
    color: fg,
    border: tone === "neutral" ? "1px solid rgba(251,243,212,0.6)" : "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: Math.round(size * 0.68),
    fontWeight: 600,
    lineHeight: 1,
    flexShrink: 0,
  };
  return (
    <span
      title={text}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontFamily: "var(--font-body)",
      }}
    >
      <span aria-hidden style={square}>
        {label.charAt(0).toUpperCase()}
      </span>
      {typeof count === "number" ? (
        <span style={{ fontSize: 14, fontWeight: 500 }}>{count}</span>
      ) : null}
      <span className="sr-only">{text}</span>
    </span>
  );
}

/**
 * A row of markers, one per product, from `countLines()` output.
 *
 * Renders NOTHING when there is nothing to count — an empty row of zeroes
 * is noise on a board that is scanned, not read.
 */
export function CountMarkers({
  lines,
  size = 16,
  gap = 10,
}: {
  lines: CountLine[];
  size?: number;
  gap?: number;
}) {
  if (lines.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap }}>
      {lines.map((l) => (
        <ProductMarker
          key={l.slug}
          label={l.label}
          tone={toneForProduct(l.slug)}
          count={l.loaves}
          size={size}
        />
      ))}
    </span>
  );
}

/** Week order for the day strip. Fixed, not derived from the plan — the
 *  point of the strip is that Monday is always in the same place, so two
 *  rows can be compared by eye. */
const WEEK_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * Mon–Sun presence strip for one plan: which days does bread go out.
 *
 * Reads the plan's own `days`, not its delivery rows, so a plan whose
 * stops are all in the past still shows the shape it was bought as.
 */
export function DayDotRow({ days }: { days: string[] }) {
  const active = new Set(days.map((d) => String(d).toLowerCase()));
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      {WEEK_KEYS.map((k) => {
        const on = active.has(k);
        const name = DAY_LABEL[k] ?? k;
        return (
          <DayDot
            key={k}
            label={name.charAt(0)}
            active={on}
            title={on ? `Delivers on ${name}` : `No delivery on ${name}`}
          />
        );
      })}
    </span>
  );
}

/**
 * Presence marker for one day: FILLED where there is a delivery, hollow
 * outline where there is not.
 *
 * Absence is drawn as empty, not as red. A once-a-week plan is the common
 * case, so red-for-no-delivery would paint six alarm-coloured cells on
 * every row of a board where red otherwise means destructive — a screen
 * that looks like a problem when nothing is wrong.
 */
export function DayDot({
  label,
  active,
  title,
}: {
  /** Day initial, e.g. "M". */
  label: string;
  active: boolean;
  title: string;
}) {
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        fontFamily: "var(--font-body)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: active ? "#3FBF6A" : "transparent",
          border: active ? "none" : "1px solid rgba(251,243,212,0.35)",
          display: "inline-block",
        }}
      />
      <span
        aria-hidden
        style={{
          fontSize: 9,
          letterSpacing: "0.04em",
          color: active ? "rgba(251,243,212,0.8)" : "rgba(251,243,212,0.35)",
        }}
      >
        {label}
      </span>
      <span className="sr-only">{title}</span>
    </span>
  );
}
