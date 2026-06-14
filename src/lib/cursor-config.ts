// Cursor config.
//
// One flag controls which cursor the whole site uses. All are pure animated
// effects (no images) drawn on a GPU-friendly overlay.
//
// Bakery-themed (BakeryCursor):
//   • "dough"     — elastic dot that stretches/squishes with pointer velocity
//                   and springs back to round when still. (default)
//   • "flour"     — a flour-puff of cream particles bursts on click.
//   • "ribbon"    — a golden crust-colored ribbon trails behind the pointer.
//   • "knead"     — soft ripple expands on click; the cursor rises over clickables.
//   • "steam"     — warm steam wisps curl up from the pointer as it moves.
//
// Motion overlay (AnimatedCursor):
//   • "magnetic"  — gold dot + ring that wraps the hovered element's bounds.
//   • "glow"      — warm gold blurred glow easing after the pointer.
//   • "spotlight" — soft spotlight + a thin gold ring that closes in on hover.
//
// Original:
//   • "classic"   — the original gold dot + ring GSAP overlay (CustomCursor).
//
// To change the default for ALL visitors, edit DEFAULT_CURSOR_VARIANT below.
//
// To compare them on a single deploy without redeploying, append a query
// param to any URL, e.g. ?cursor=dough | ?cursor=ribbon | ?cursor=classic.
// The choice is persisted to localStorage so it sticks while you browse.

export type CursorVariant =
  | "classic"
  | "magnetic"
  | "glow"
  | "spotlight"
  | "dough"
  | "flour"
  | "ribbon"
  | "knead"
  | "steam";

export const DEFAULT_CURSOR_VARIANT: CursorVariant = "dough";

export const CURSOR_VARIANTS: readonly CursorVariant[] = [
  "classic",
  "magnetic",
  "glow",
  "spotlight",
  "dough",
  "flour",
  "ribbon",
  "knead",
  "steam",
] as const;

// Variants handled by the bakery-themed overlay (BakeryCursor). The other
// non-classic variants are handled by AnimatedCursor.
export const BAKERY_VARIANTS = [
  "dough",
  "flour",
  "ribbon",
  "knead",
  "steam",
] as const;

const STORAGE_KEY = "cadieux_cursor_variant";

export function isCursorVariant(v: unknown): v is CursorVariant {
  return (
    typeof v === "string" && (CURSOR_VARIANTS as readonly string[]).includes(v)
  );
}

export function isBakeryVariant(
  v: CursorVariant,
): v is (typeof BAKERY_VARIANTS)[number] {
  return (BAKERY_VARIANTS as readonly string[]).includes(v);
}

// Resolve the active variant client-side: a ?cursor= query param wins (and is
// persisted), else the last persisted choice, else the configured default.
// SSR-safe — returns the default on the server.
export function resolveCursorVariant(): CursorVariant {
  if (typeof window === "undefined") return DEFAULT_CURSOR_VARIANT;
  try {
    const param = new URLSearchParams(window.location.search).get("cursor");
    if (isCursorVariant(param)) {
      window.localStorage.setItem(STORAGE_KEY, param);
      return param;
    }
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isCursorVariant(stored)) return stored;
  } catch {
    /* localStorage blocked (private mode / cookies off) — fall through */
  }
  return DEFAULT_CURSOR_VARIANT;
}
