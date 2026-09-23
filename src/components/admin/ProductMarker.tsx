// Coloured square + letter, naming a product at a glance.
//
// Built generic — (kind, label, tone) — because the same marker is wanted
// for other axes later (veg / non-veg on the sandwich board). Nothing here
// knows about bread; the bread mapping lives in PRODUCT_TONES below and is
// the only part that would change.
//
// TONES. Protein Bread green, Multigrain RED, Burger bun yellow.
//
// THE PALETTE IS SUNNY'S, DECIDED 2026-09-22, and it overrules what this
// file used to argue. The original objection is kept verbatim because it is
// the reason the decision had to be made at all:
//
//   "Multigrain must be amber and NOT red: #EF4444 appears 101 times across
//    this admin and means destructive every time — cancel, delete, the
//    failure line on a bulk result. A colour that means 'you are about to
//    lose something' must not also mean 'this bag has multigrain in it', or
//    the operator learns to discount it."
//
// What answers it: THE TWO REDS ARE NOT THE SAME RED. Destructive is
// #EF4444. The Multigrain product tone is #D6453F — the value LoafDots has
// painted on every /admin/orders row since it shipped. They are
// distinguishable side by side and they never appear in the same role, so
// the collision the objection feared does not occur.
//
// Sunny's deciding reason: red is what he already reads on the orders board
// every morning, so amber here meant one loaf was two different colours on
// two different boards. And with a third product arriving, amber (#F59E0B)
// and the bun's yellow (#F2C037) are too close to separate at a glance —
// three clearly distinct colours beat two that look alike.
//
// This file is now the ONE source of product colour: LoafDots imports
// PRODUCT_TONES/TONE_COLOURS from here and declares none of its own. The
// "known inconsistency" note that used to sit here is resolved, not moved.

import type { CSSProperties } from "react";
import { DAY_LABEL } from "@/lib/subscription-ui";
import type { CountLine } from "@/lib/subscription-counts";

export type MarkerTone = "green" | "red" | "yellow" | "neutral";

export const TONE_COLOURS: Record<MarkerTone, { bg: string; fg: string }> = {
  // Near-black ink on the three saturated fills. Yellow especially needs a
  // dark letter — cream on #F2C037 is under 2:1 and unreadable at 16px.
  green: { bg: "#3FBF6A", fg: "#0F1A18" },
  // NOT #EF4444 (destructive). See the header.
  red: { bg: "#D6453F", fg: "#0F1A18" },
  yellow: { bg: "#F2C037", fg: "#0F1A18" },
  // A product we have no tone for: hollow, never a guessed colour. An
  // unknown bread silently rendering as Protein Bread is exactly the class
  // of bug this whole branch exists to remove.
  neutral: { bg: "transparent", fg: "#FBF3D4" },
};

/** slug → tone. The ONLY product-aware line in this file, and the registry
 *  every other surface reads — adding a product means adding it HERE and
 *  nowhere else. Keys are the `slug`/`product_id` vocabulary shared by both
 *  orders.items shapes and by subscription_items.product_slug. */
export const PRODUCT_TONES: Record<string, MarkerTone> = {
  "high-protein": "green",
  multigrain: "red",
  "burger-bun": "yellow",
};

/** slug → the letter in the square. FIXED per product, never derived from
 *  the name.
 *
 *  Deriving it was the bug: the square read `name.charAt(0)`, so when
 *  `products.name` for the bun was "Whole wheat protein Burger Bun" the
 *  marker said **W**, and it would have changed again on the next rename —
 *  an identifier the operator has learned by sight must not move when
 *  marketing copy does. P / M / B are the letters Sunny already says out
 *  loud. Registered alongside PRODUCT_TONES so a new product is still one
 *  edit to this file.
 *
 *  A slug with no entry falls back to the name's first letter, which is the
 *  old behaviour and the only thing available for a product this file has
 *  never heard of. */
export const PRODUCT_INITIALS: Record<string, string> = {
  "high-protein": "P",
  multigrain: "M",
  "burger-bun": "B",
};

// NAMES ARE NOT DECIDED HERE EITHER. This file used to carry a
// PRODUCT_LABELS map of short names ("Plain" / "Multigrain" / "Burger
// Bun"). It is gone: those were a second, hand-maintained spelling of the
// catalogue, so renaming a product in /admin left the admin boards saying
// something the shop no longer said. Callers resolve slug → name through
// productDisplayName() in @/lib/product-names, which reads the live
// catalogue. This file owns colour and the one-letter code — neither of
// which is a name.

export function toneForProduct(slug: string): MarkerTone {
  return PRODUCT_TONES[slug] ?? "neutral";
}

export function initialForProduct(slug: string): string | undefined {
  return PRODUCT_INITIALS[slug];
}

/**
 * One marker. `label` is the full catalogue name ("Multigrain Protein
 * Bread") — the title attribute and the screen-reader label carry the whole
 * thing, so the letter is never the only way to tell them apart. Colour is
 * the primary signal; the letter is the tie-breaker and the tooltip is the
 * answer.
 *
 * `initial` is the fixed per-product letter (see PRODUCT_INITIALS). It is a
 * separate prop rather than something derived from `label` precisely so a
 * name change cannot move it.
 */
export function ProductMarker({
  label,
  tone,
  count,
  title,
  initial,
  size = 16,
}: {
  label: string;
  tone: MarkerTone;
  /** Rendered beside the square when given. Omit for a bare marker. */
  count?: number;
  /** Overrides the default "<label> <count>" tooltip. */
  title?: string;
  /** Letter in the square. Defaults to the label's first letter for a
   *  product with no registered code. */
  initial?: string;
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
        {(initial ?? label.charAt(0)).toUpperCase()}
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
          initial={initialForProduct(l.slug)}
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
