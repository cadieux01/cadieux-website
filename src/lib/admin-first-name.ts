// Best-effort first-name storage for the admin operator, used as the
// `author` field on order_notes. Kept intentionally trivial:
//   - localStorage under a single key, no expiry
//   - free-form string, capped in the API on write
//   - null when the browser has never asked / the operator cancelled
//
// This is UI convenience, not identity — the auth on notes is the same
// admin session token as every other /api/admin/* call.

const KEY = "cadieux_admin_first_name";

export function getAdminFirstName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export function setAdminFirstName(name: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!name) {
      window.localStorage.removeItem(KEY);
      return;
    }
    const trimmed = name.trim().slice(0, 60);
    if (trimmed.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, trimmed);
  } catch {
    /* storage unavailable — author simply stays null */
  }
}

/**
 * Prompt (once, then cached) for the operator's first name. Returns the
 * cached value on every subsequent call. Never throws; a null return
 * (either the browser can't prompt, or the operator hit Cancel) just
 * means the note is written with author=null, which is a valid shape.
 */
export function ensureAdminFirstName(): string | null {
  const existing = getAdminFirstName();
  if (existing) return existing;
  if (typeof window === "undefined") return null;
  const asked = window.prompt(
    "Your first name — will appear on every note you add. Leave blank to skip.",
    "",
  );
  if (asked === null) return null;
  const trimmed = asked.trim().slice(0, 60);
  if (trimmed.length === 0) return null;
  setAdminFirstName(trimmed);
  return trimmed;
}
