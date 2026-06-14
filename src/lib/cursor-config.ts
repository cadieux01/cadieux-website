// Cursor config.
//
// One flag controls which cursor the whole site uses. All are pure animated
// effects (no images) drawn on a GPU-friendly overlay:
//   • "magnetic"  — gold dot + a spring-lagged ring that magnetically wraps
//                   and hugs the hovered link/button's bounds. (default)
//   • "glow"      — a warm gold blurred glow that eases after the pointer and
//                   brightens/expands over clickables.
//   • "spotlight" — a small gold dot + a faint soft spotlight that lightens
//                   what it passes; a thin gold ring closes in over clickables.
//   • "classic"   — the original gold dot + ring GSAP overlay (CustomCursor).
//
// To change the default for ALL visitors, edit DEFAULT_CURSOR_VARIANT below.
//
// To compare them on a single deploy without redeploying, append a query
// param to any URL: ?cursor=magnetic | ?cursor=glow | ?cursor=spotlight |
// ?cursor=classic. The choice is persisted to localStorage so it sticks
// while you browse.

export type CursorVariant = "classic" | "magnetic" | "glow" | "spotlight";

export const DEFAULT_CURSOR_VARIANT: CursorVariant = "magnetic";

export const CURSOR_VARIANTS: readonly CursorVariant[] = [
  "classic",
  "magnetic",
  "glow",
  "spotlight",
] as const;

const STORAGE_KEY = "cadieux_cursor_variant";

export function isCursorVariant(v: unknown): v is CursorVariant {
  return (
    v === "classic" || v === "magnetic" || v === "glow" || v === "spotlight"
  );
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
