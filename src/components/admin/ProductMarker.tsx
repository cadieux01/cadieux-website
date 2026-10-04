// Coloured pill + two-letter code, naming a product at a glance.
//
// Built generic — (kind, label, tone) — because the same marker is wanted
// for other axes later (veg / non-veg on the sandwich board). Nothing here
// knows about bread; the bread mapping lives in PRODUCT_TONES below and is
// the only part that would change.
//
// TONES. Protein Bread green, Multigrain RED, Burger bun yellow, Pizza Base
// blue, Multigrain Bun violet, Multigrain Pizza Base plum — six products,
// six hues, one per product. Sunny's call 2026-10-03: colour means PRODUCT,
// not form, so Multigrain Bread keeps the red it has always had.
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

export type MarkerTone =
  | "green"
  | "red"
  | "yellow"
  | "blue"
  | "violet"
  | "plum"
  | "neutral";

// Adding a member here and forgetting its fill is a COMPILE ERROR, not a
// hollow marker in production: TONE_COLOURS is the only exhaustive
// Record<MarkerTone, …> in the codebase, so tsc refuses the build until the
// colour exists. That is the one safety property this file has; keep it.
export const TONE_COLOURS: Record<MarkerTone, { bg: string; fg: string }> = {
  // Near-black ink on every saturated fill. Yellow especially needs a dark
  // letter — cream on #F2C037 is under 2:1 and unreadable at 16px. All six
  // product fills clear 4.5:1 against #0F1A18, so the letter colour is the
  // same on all of them and never has to be reasoned about per tone.
  green: { bg: "#3FBF6A", fg: "#0F1A18" },
  // NOT #EF4444 (destructive). See the header.
  red: { bg: "#D6453F", fg: "#0F1A18" },
  yellow: { bg: "#F2C037", fg: "#0F1A18" },
  // THE THREE HUES ADDED 2026-10-03, measured not eyeballed. Each figure is
  // WCAG contrast against the admin page INK (#1D1D1F) / against the letter:
  //
  //   blue   #4C8DF6  5.17:1 / 5.46:1   pizza-base
  //   violet #B382F5  5.95:1 / 6.29:1   multigrain-bun
  //   plum   #E6A7C7  8.59:1 / 9.07:1   multigrain-pizza-base
  //
  // Why not a darker, truer plum: a dark plum CANNOT clear 4.5:1 on a
  // near-black page. Measured — eggplant #614051 is 1.89:1, Tailwind
  // purple-700 #7E22CE is 2.41:1, and even purple-500 #A855F7 misses at
  // 4.25:1. On this background "plum" has to mean a light plum or nothing.
  //
  // GREYSCALE: SIX HUES DO NOT SEPARATE ON PAPER. This is the honest version
  // of a claim an earlier draft of this comment got wrong — it said these
  // were "the best greyscale placement available for the print sheet", which
  // overstated a palette chosen for the screen. Six hues that each clear
  // 4.5:1 on a near-black ground are all light, so they crowd the top of the
  // grey ramp and two pairs genuinely collide. Measured, 8-bit BT.601 luma
  // (what a mono printer approximates) and WCAG luminance ratio:
  //
  //   red 112 | blue 134 | green 143 | violet 158 | plum 189 | yellow 191
  //
  //   yellow / plum   grey 191 vs 189 — 2 levels apart, ratio 1.154
  //   blue   / violet grey 134 vs 158, but WCAG ratio 1.152
  //   blue   / green  grey 134 vs 143 — 9 levels, ratio 1.447
  //
  // Those are the two closest pairs and they are NOT separable in greyscale.
  // Sunny accepted yellow/plum knowingly. What this means in practice: the
  // run sheet at /admin/orders/print prints item names as TEXT, not colour,
  // so a mono print of the sheet is unaffected. A browser-printed ORDERS
  // BOARD is where the collision lands, because LoafDots there is colour
  // only. If that ever becomes the operator's paper workflow, the dots need a
  // non-colour channel (shape), not a nudged hue — a cream ring was measured
  // at 1.53:1 against the yellow fill and does not work.
  //
  // Why this blue and this violet out of the candidates: both models were
  // ranked over 3 blues x 5 violets and #4C8DF6 + #B382F5 is the only pair
  // whose worst collision on BOTH models is the accepted yellow/plum one.
  // #60A5FA + #A672F3 put green and violet 1 grey level apart; #5799F8 +
  // #A672F3 put blue and violet at the SAME grey level. Do not nudge either
  // for taste without re-running both models; one model alone will mislead.
  blue: { bg: "#4C8DF6", fg: "#0F1A18" },
  violet: { bg: "#B382F5", fg: "#0F1A18" },
  plum: { bg: "#E6A7C7", fg: "#0F1A18" },
  // A product we have no tone for: hollow, never a guessed colour. An
  // unknown bread silently rendering as Protein Bread is exactly the class
  // of bug this whole branch exists to remove. With all six catalogue slugs
  // registered below, nothing in the catalogue reaches this any more — it is
  // the guard for the seventh product, not a state the boards show today.
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
  "pizza-base": "blue",
  "multigrain-bun": "violet",
  "multigrain-pizza-base": "plum",
};

/** slug → the code in the pill. FIXED per product, never derived from the
 *  name.
 *
 *  Deriving it was the bug: the square read `name.charAt(0)`, so when
 *  `products.name` for the bun was "Whole wheat protein Burger Bun" the
 *  marker said **W**, and it would have changed again on the next rename —
 *  an identifier the operator has learned by sight must not move when
 *  marketing copy does.
 *
 *  WHY TWO LETTERS NOW. At three products the first letters were P / M / B
 *  and distinct. At six they would be P, M, B, P, M, M — the Pizza Base and
 *  Protein Bread would both read **P**, and three different products would
 *  all read **M**. A single letter stopped disambiguating anything the day
 *  the catalogue reached six, so the code is two letters: the GRAIN then the
 *  FORM.
 *
 *    grain   P = protein (plain)      M = multigrain
 *    form    L = loaf   B = bun   Z = pizza base
 *
 *  Reading them as a grid is the point — ML and MZ are visibly the same
 *  family, and the second letter answers "which shape" without a tooltip.
 *
 *  A slug with no entry falls back to the name's first letter, which is the
 *  old behaviour and the only thing available for a product this file has
 *  never heard of. All six catalogue slugs are registered, so nothing ships
 *  on that fallback today. */
export const PRODUCT_INITIALS: Record<string, string> = {
  "high-protein": "PL",
  multigrain: "ML",
  "burger-bun": "PB",
  "pizza-base": "PZ",
  "multigrain-bun": "MB",
  "multigrain-pizza-base": "MZ",
};

// NAMES ARE NOT DECIDED HERE EITHER. This file used to carry a
// PRODUCT_LABELS map of short names ("Plain" / "Multigrain" / "Burger
// Bun"). It is gone: those were a second, hand-maintained spelling of the
// catalogue, so renaming a product in /admin left the admin boards saying
// something the shop no longer said. Callers resolve slug → name through
// productDisplayName() in @/lib/product-names, which reads the live
// catalogue. This file owns colour and the two-letter code — neither of
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
 * thing, so the code is never the only way to tell them apart. Colour is
 * the primary signal; the code is the tie-breaker and the tooltip is the
 * answer.
 *
 * `initial` is the fixed per-product code (see PRODUCT_INITIALS). It is a
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
  /** Rendered beside the pill when given. Omit for a bare marker. */
  count?: number;
  /** Overrides the default "<label> <count>" tooltip. */
  title?: string;
  /** Code in the pill. Defaults to the label's first letter for a product
   *  with no registered code. */
  initial?: string;
  size?: number;
}) {
  const { bg, fg } = TONE_COLOURS[tone];
  const text =
    title ?? (typeof count === "number" ? `${label} ${count}` : label);
  // A PILL, NOT A SQUARE. Two characters do not fit a square at these sizes:
  // `size` is the height and the font is 0.68 of it, so the tightest call site
  // (size={14}, subscriptions/[id]) has a 10px font and ~12px of glyph to put
  // in 14px of box. The height and the font size are both left exactly as they
  // were and the box is widened instead — shrinking the text to fit was the
  // alternative and it makes a 10px font into an 7px one, which is the
  // operator's problem, not the layout's.
  //
  // `minWidth: size` keeps a one-character fallback code rendering as the
  // original square rather than a narrow sliver.
  const pill: CSSProperties = {
    minWidth: size,
    height: size,
    padding: "0 4px",
    borderRadius: size / 2,
    background: bg,
    color: fg,
    border: tone === "neutral" ? "1px solid rgba(251,243,212,0.6)" : "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: Math.round(size * 0.68),
    fontWeight: 600,
    lineHeight: 1,
    // 0.02em of tracking, so the two letters read as a code rather than as a
    // ligature at 10px. Not negative — tightening them is compression by
    // another name.
    letterSpacing: "0.02em",
    flexShrink: 0,
    boxSizing: "border-box",
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
      <span aria-hidden style={pill}>
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
