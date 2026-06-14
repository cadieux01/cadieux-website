// Cursor config.
//
// One flag controls which cursor the whole site uses:
//   • "bread"   — premium artisan-loaf cursor (pure CSS, retina image-set,
//                 gold glow/ring affordance on hover). This is the default.
//   • "classic" — the original gold dot + ring GSAP overlay (CustomCursor)
//
// To change the default for ALL visitors, edit DEFAULT_CURSOR_VARIANT below.
//
// To compare the two on a single deploy without redeploying, append a query
// param to any URL: ?cursor=bread | ?cursor=classic
// The choice is persisted to localStorage so it sticks while you browse.

export type CursorVariant = "classic" | "bread";

export const DEFAULT_CURSOR_VARIANT: CursorVariant = "bread";

export const CURSOR_VARIANTS: readonly CursorVariant[] = [
  "classic",
  "bread",
] as const;

const STORAGE_KEY = "cadieux_cursor_variant";

export function isCursorVariant(v: unknown): v is CursorVariant {
  return v === "classic" || v === "bread";
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
