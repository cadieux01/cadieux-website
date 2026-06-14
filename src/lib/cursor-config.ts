// Bread-cursor variant config.
//
// One flag controls which cursor the whole site uses. Variants:
//   • "classic" — the original gold dot + ring GSAP overlay (CustomCursor)
//   • "v1"      — subtle: cream bread loaf cursor; links show a gold loaf
//   • "v2"      — loaf cursor; links show a wheat sprig
//   • "v3"      — same as v1 + a light trailing-crumb effect (reduced-motion safe)
//
// To change the default for ALL visitors, edit DEFAULT_CURSOR_VARIANT below.
//
// To COMPARE variants on a single deploy without redeploying, append a query
// param to any URL: ?cursor=v1 | ?cursor=v2 | ?cursor=v3 | ?cursor=classic
// The choice is persisted to localStorage so it sticks while you browse.

export type CursorVariant = "classic" | "v1" | "v2" | "v3";

export const DEFAULT_CURSOR_VARIANT: CursorVariant = "v1";

export const CURSOR_VARIANTS: readonly CursorVariant[] = [
  "classic",
  "v1",
  "v2",
  "v3",
] as const;

const STORAGE_KEY = "cadieux_cursor_variant";

export function isCursorVariant(v: unknown): v is CursorVariant {
  return v === "classic" || v === "v1" || v === "v2" || v === "v3";
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
